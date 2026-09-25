import type { Ports } from "@/core/ports";
import type { FirewallRule } from "@/core/hetzner/types";
import { FakeHetzner, server } from "@/core/testing/fake-hetzner";
import { MemoryFiles, MemorySecrets } from "@/core/testing/memory";

const any = ["0.0.0.0/0", "::/0"];
const r = (protocol: FirewallRule["protocol"], port: string | null, src: string[], d: string | null = null): FirewallRule => ({
  direction: "in", protocol, port, source_ips: src, destination_ips: [], description: d,
});
const full = (src: string[], d: string | null = null) => [r("tcp", "1-65535", src, d), r("udp", "1-65535", src, d), r("icmp", null, src, d)];
const managed = { "managed-by": "hfenceline" };

const CONFIG = `# Demo-Konfiguration
version: 1
language: de
homeip:
  last_applied: 203.0.113.99

templates:
  - id: standard
    name: Standard
    blocks:
      - id: web
        name: Web öffentlich
        rules:
          - { protocol: tcp, port: "80", from: [any] }
          - { protocol: tcp, port: "443", from: [any] }
      - id: admin
        name: Admin von zu Hause
        rules:
          - { protocol: all, from: ["{home}"] }
      - id: static
        name: Feste IPs
        rules:
          - { protocol: all, from: ["{static}"] }
      - id: ping
        name: Ping
        optional: true
        default: false
        rules:
          - { protocol: icmp, from: [any] }
  - id: nur-admin
    name: Nur Admin
    blocks:
      - id: admin
        name: Admin von zu Hause
        rules:
          - { protocol: all, from: ["{home}"] }

customers:
  - id: privat
    name: Privat
    projects:
      - id: webserver
        name: Webserver
        firewalls:
          - hetzner_id: 101
            template: standard
            blocks: { ping: true }
            static_ips:
              - { cidr: 198.51.100.10/32, note: Büro }
  - id: kunde-x
    name: Kunde X
    projects:
      - id: shop
        name: Shop
        firewalls:
          - hetzner_id: 201
            template: standard
            static_ips:
              - { cidr: 192.0.2.0/24, note: Netz Kunde X }
            extra_rules:
              - { name: Monitoring, protocol: tcp, port: "9100", from: [192.0.2.5/32] }
          - hetzner_id: 202
            template: nur-admin
      - id: staging
        name: Staging
        firewalls:
          - hetzner_id: 301
            template: standard
`;

export function demoPorts(empty = false): Ports {
  const api = new FakeHetzner();
  api.delayMs = 250;
  api.homeIp = "203.0.113.7";
  const old = "203.0.113.99/32";

  api.project("demo-privat-web", {
    firewalls: [
      {
        id: 101, name: "webserver-standard", labels: managed, applied_to: [],
        rules: [
          r("tcp", "80", any, "hfl:web Web öffentlich"), r("tcp", "443", any, "hfl:web Web öffentlich"),
          ...full([old], "hfl:admin Admin von zu Hause"),
          ...full(["198.51.100.10/32"], "hfl:static Feste IPs"),
          r("icmp", null, any, "hfl:ping Ping"),
        ],
      },
      {
        id: 102, name: "altes-setup", labels: {}, applied_to: [],
        rules: [r("tcp", "80", any), r("tcp", "443", any), ...full([old]), r("tcp", "5432", ["198.51.100.20/32"], "Postgres Kollege")],
      },
    ],
    servers: [server(1, "web-1", [101]), server(2, "web-2", [101]), server(3, "db-1", [102]), server(4, "test-neu")],
  });

  api.project("demo-x-shop", {
    firewalls: [
      {
        id: 201, name: "shop-standard", labels: managed, applied_to: [],
        rules: [
          r("tcp", "80", any, "hfl:web Web öffentlich"), r("tcp", "8443", any, "hfl:web Web öffentlich"),
          ...full([old], "hfl:admin Admin von zu Hause"),
          ...full(["192.0.2.0/24"], "hfl:static Feste IPs"),
          r("tcp", "9100", ["192.0.2.5/32"], "hfl:extra Monitoring"),
          r("tcp", "22", ["198.51.100.44/32"], "SSH Agentur"),
        ],
      },
      { id: 202, name: "shop-admin", labels: managed, applied_to: [], rules: [...full(["203.0.113.7/32"], "hfl:admin Admin von zu Hause")] },
    ],
    servers: [server(11, "shop-app", [201]), server(12, "shop-db", [202])],
  });

  const files = new MemoryFiles();
  const secrets = new MemorySecrets();
  if (empty) {
    for (const p of api.projects.values()) {
      for (const f of p.firewalls) {
        f.labels = {};
        f.rules = f.rules.map((r) => (r.description?.startsWith("hfl:") ? { ...r, description: null } : r));
      }
    }
  } else {
    files.files.set("config.yaml", CONFIG);
    secrets.values.set("hfenceline/privat/webserver", "demo-privat-web");
    secrets.values.set("hfenceline/kunde-x/shop", "demo-x-shop");
    secrets.values.set("hfenceline/kunde-x/staging", "abgelaufen");
  }

  return { fetch: api.fetch, files, secrets, now: () => new Date() };
}
