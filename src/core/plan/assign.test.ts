import { describe, expect, it } from "vitest";
import { standardTemplate } from "../model/defaults";
import type { ManagedFirewall } from "../model/config";
import type { FirewallRule } from "../hetzner/types";
import { suggestAssignment } from "./assign";
import { plan } from "./plan";
import { ruleKey } from "./rules";

const T = standardTemplate("de");
const HOME = "203.0.113.7";
const any = ["0.0.0.0/0", "::/0"];

function rule(protocol: FirewallRule["protocol"], port: string | null, sources: string[], description: string | null = null): FirewallRule {
  return { direction: "in", protocol, port, source_ips: sources, destination_ips: [], description };
}
const full = (sources: string[], desc: string | null = null) => [
  rule("tcp", "1-65535", sources, desc),
  rule("udp", "1-65535", sources, desc),
  rule("icmp", null, sources, desc),
];

const handmade: FirewallRule[] = [
  rule("tcp", "80", any),
  rule("tcp", "443", any),
  ...full(["203.0.113.99/32"]),
  ...full(["198.51.100.10/32", "192.0.2.0/24"]),
  rule("icmp", null, any),
  rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde"),
];

describe("suggestAssignment", () => {
  it("handgepflegte fw", () => {
    const r = suggestAssignment({ template: T, actual: handmade, homeIp: HOME });
    expect(r.homeCandidate).toEqual({ cidr: "203.0.113.99/32", confident: false });
    expect(r.fullAccessHosts.sort()).toEqual(["198.51.100.10/32", "203.0.113.99/32"]);
    expect(r.settings.blocks).toEqual({ ping: true });
    expect(r.settings.static_ips).toEqual([{ cidr: "192.0.2.0/24" }, { cidr: "198.51.100.10/32" }]);
    expect(r.foreign).toEqual([rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde")]);
  });

  it("erkennt die aktuelle Home-IP sicher", () => {
    const actual = [rule("tcp", "80", any), rule("tcp", "443", any), ...full([`${HOME}/32`]), ...full(["198.51.100.10/32"])];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME });
    expect(r.homeCandidate).toEqual({ cidr: `${HOME}/32`, confident: true });
    expect(r.settings.static_ips).toEqual([{ cidr: "198.51.100.10/32" }]);
    expect(r.foreign).toEqual([]);
    expect(r.settings.blocks).toEqual({ ping: false });
  });

  it("last_applied", () => {
    const actual = [...full(["203.0.113.99/32"]), ...full(["198.51.100.10/32"])];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME, lastHomeIp: "203.0.113.99" });
    expect(r.homeCandidate).toEqual({ cidr: "203.0.113.99/32", confident: true });
    expect(r.settings.static_ips).toEqual([{ cidr: "198.51.100.10/32" }]);
  });

  it("einzelne /32 = alte home-ip", () => {
    const r = suggestAssignment({ template: T, actual: [...full(["203.0.113.99/32"])], homeIp: HOME });
    expect(r.homeCandidate).toEqual({ cidr: "203.0.113.99/32", confident: false });
    expect(r.covered).toHaveLength(3);
  });

  it("home-ip gewählt", () => {
    const r = suggestAssignment({ template: T, actual: handmade, homeIp: HOME, homeSource: "198.51.100.10/32" });
    expect(r.homeCandidate).toEqual({ cidr: "198.51.100.10/32", confident: true });
    expect(r.settings.static_ips?.map((s) => s.cidr).sort()).toEqual(["192.0.2.0/24", "203.0.113.99/32"]);
  });

  it("keine home-ip", () => {
    const r = suggestAssignment({ template: T, actual: handmade, homeIp: HOME, homeSource: null });
    expect(r.homeCandidate).toBeNull();
    expect(r.settings.static_ips?.map((s) => s.cidr).sort()).toEqual([
      "192.0.2.0/24",
      "198.51.100.10/32",
      "203.0.113.99/32",
    ]);
  });

  it("tcp-only ist kein voller zugriff", () => {
    const actual = [rule("tcp", "1-65535", ["203.0.113.99/32"]), rule("tcp", "1-65535", ["198.51.100.7/32"]), rule("udp", "1-65535", ["198.51.100.7/32"])];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME });
    expect(r.homeCandidate).toBeNull();
    expect(r.fullAccessHosts).toEqual([]);
    expect(r.settings.static_ips).toBeUndefined();
    expect(r.covered).toEqual([]);
    expect(r.foreign).toEqual(actual);
  });

  it("tcp-only bleibt tcp-only", () => {
    const tcpOnly = rule("tcp", "1-65535", ["198.51.100.7/32"], "Backup-Server");
    const actual = [...full([`${HOME}/32`]), tcpOnly];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME });
    const p = plan({
      template: T,
      firewall: { hetzner_id: 1, template: "standard", ...r.settings },
      actual,
      homeIp: HOME,
      dropForeign: new Set(r.covered.map(ruleKey)),
    });
    const sources = (proto: string) => p.rules.filter((x) => x.protocol === proto).flatMap((x) => x.source_ips);
    expect(sources("udp")).not.toContain("198.51.100.7/32");
    expect(sources("icmp")).not.toContain("198.51.100.7/32");
    expect(p.rules).toContainEqual(tcpOnly);
  });

  it("notizen bleiben", () => {
    const previous: ManagedFirewall = {
      hetzner_id: 1,
      template: "standard",
      static_ips: [{ cidr: "198.51.100.10/32", note: "Büro" }],
    };
    const actual = [...full([`${HOME}/32`], "hfl:admin Admin von zu Hause"), ...full(["198.51.100.10/32", "192.0.2.5/32"], "hfl:static Feste IPs")];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME, previous });
    expect(r.settings.static_ips).toEqual([{ cidr: "192.0.2.5/32" }, { cidr: "198.51.100.10/32", note: "Büro" }]);
  });

  it("übrige hfl-regeln -> zusatzregeln", () => {
    const actual = [
      ...full([`${HOME}/32`], "hfl:admin Admin von zu Hause"),
      rule("tcp", "9100", ["192.0.2.5/32"], "hfl:extra Monitoring"),
      ...full(["192.0.2.9/32"], "hfl:extra Backup"),
    ];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME });
    expect(r.settings.extra_rules).toEqual([
      { name: "Monitoring", protocol: "tcp", port: "9100", from: ["192.0.2.5/32"] },
      { name: "Backup", protocol: "all", from: ["192.0.2.9/32"] },
    ]);
    expect(r.settings.static_ips).toBeUndefined();
  });

  it("ist ins soll -> in sync", () => {
    const actual = [
      rule("tcp", "80", any, "hfl:web Web öffentlich"),
      rule("tcp", "443", any, "hfl:web Web öffentlich"),
      ...full([`${HOME}/32`], "hfl:admin Admin von zu Hause"),
      ...full(["198.51.100.10/32", "192.0.2.5/32"], "hfl:static Feste IPs"),
      rule("icmp", null, any, "hfl:ping Ping"),
      rule("tcp", "9100", ["192.0.2.5/32"], "hfl:extra Monitoring"),
      rule("tcp", "22", ["198.51.100.1/32"], "fremd"),
    ];
    const r = suggestAssignment({ template: T, actual, homeIp: HOME });
    const firewall: ManagedFirewall = { hetzner_id: 1, template: "standard", ...r.settings };
    const p = plan({ template: T, firewall, actual, homeIp: HOME });
    expect(p.status.inSync).toBe(true);
    expect(p.foreign.map((f) => ruleKey(f.rule))).toEqual([ruleKey(actual.at(-1)!)]);
  });

  it("import ersetzt alte home-ip", () => {
    const r = suggestAssignment({ template: T, actual: handmade, homeIp: HOME });
    const firewall: ManagedFirewall = { hetzner_id: 1, template: "standard", ...r.settings };
    const p = plan({ template: T, firewall, actual: handmade, homeIp: HOME, dropForeign: new Set(r.covered.map(ruleKey)) });
    const sources = p.rules.flatMap((x) => x.source_ips);
    expect(sources).toContain(`${HOME}/32`);
    expect(sources).not.toContain("203.0.113.99/32");
    expect(p.rules).toContainEqual(rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde"));
  });
});
