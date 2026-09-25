import { describe, expect, it } from "vitest";
import { MemoryFiles } from "../testing/memory";
import { defaultConfig } from "../model/defaults";
import { ConfigError, ConfigStore } from "./config-store";

const EXAMPLE = `# Meine Firewalls
version: 1
language: de
homeip:
  last_applied: 203.0.113.7 # zuletzt übernommen

templates:
  - id: standard
    name: Standard
    blocks:
      - id: web
        name: Web öffentlich
        rules:
          - { protocol: tcp, port: "80",  from: [any] }
          - { protocol: tcp, port: "443", from: [any] }
      - id: admin
        name: Admin von zu Hause
        rules:
          - { protocol: all, from: ["{heim}"] }

customers:
  # Private Projekte
  - id: privat
    name: Privat
    projects:
      - id: web
        name: Webserver
        firewalls:
          - hetzner_id: 1234567
            template: standard
            blocks: { ping: true }
            static_ips:
              - { cidr: 198.51.100.10/32, note: Büro Kunde X } # wichtig
`;

async function storeWith(text?: string) {
  const files = new MemoryFiles();
  if (text !== undefined) files.files.set("config.yaml", text);
  return { files, store: new ConfigStore(files) };
}

describe("ConfigStore", () => {
  it("liefert null beim ersten Start", async () => {
    const { store } = await storeWith();
    expect(await store.load()).toBeNull();
  });

  it("beispiel lesen", async () => {
    const { store } = await storeWith(EXAMPLE);
    const c = await store.load();
    expect(c?.customers[0]?.projects[0]?.firewalls[0]?.static_ips).toEqual([{ cidr: "198.51.100.10/32", note: "Büro Kunde X" }]);
    expect(c?.templates[0]?.blocks[1]?.rules[0]?.from).toEqual(["{heim}"]);
  });

  it("kommentare bleiben", async () => {
    const { store, files } = await storeWith(EXAMPLE);
    const c = (await store.load())!;
    c.homeip.last_applied = "203.0.113.8";
    c.customers[0]!.projects[0]!.firewalls[0]!.static_ips!.push({ cidr: "192.0.2.0/24", note: "Neu" });
    await store.save(c);
    const out = files.files.get("config.yaml")!;
    expect(out).toContain("# Meine Firewalls");
    expect(out).toContain("last_applied: 203.0.113.8 # zuletzt übernommen");
    expect(out).toContain("# Private Projekte");
    expect(out).toContain("{ cidr: 198.51.100.10/32, note: Büro Kunde X } # wichtig");
    expect(out).toContain("{ cidr: 192.0.2.0/24, note: Neu }");
    expect(out).toContain("blocks: { ping: true }");
    expect(out).toContain("\n\ntemplates:");
    expect(out).toContain('- { protocol: all, from: [ "{heim}" ] }');
  });

  it("reihenfolge per id", async () => {
    const text = `version: 1
language: de
templates: []
customers:
  - id: a # Kunde A
    name: A
  - id: b # Kunde B
    name: B
`;
    const { store, files } = await storeWith(text);
    const c = (await store.load())!;
    c.customers.reverse();
    c.customers.push({ id: "c", name: "C", projects: [] });
    await store.save(c);
    const out = files.files.get("config.yaml")!;
    expect(out.indexOf("- id: b # Kunde B")).toBeLessThan(out.indexOf("- id: a # Kunde A"));
    expect(out).toContain("id: c");
    const again = await new ConfigStore(files).load();
    expect(again?.customers.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("löschen", async () => {
    const { store, files } = await storeWith(EXAMPLE);
    const c = (await store.load())!;
    delete c.homeip.last_applied;
    c.customers[0]!.projects[0]!.firewalls = [];
    await store.save(c);
    const again = (await new ConfigStore(files).load())!;
    expect(again.homeip.last_applied).toBeUndefined();
    expect(again.customers[0]!.projects[0]!.firewalls).toEqual([]);
  });

  it("neue datei", async () => {
    const { store, files } = await storeWith();
    await store.save(defaultConfig("de"));
    const out = files.files.get("config.yaml")!;
    expect(out).toContain('- { protocol: tcp, port: "80", from: [ any ] }');
    expect(out).toContain('- { protocol: all, from: [ "{heim}" ] }');
    const again = await new ConfigStore(files).load();
    expect(again).toEqual(defaultConfig("de"));
  });

  it("ungültige config", async () => {
    const { store } = await storeWith("version: 1\nlanguage: fr\n");
    const e = await store.load().catch((x) => x);
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as ConfigError).problems.join()).toContain("language");
  });

  it("doppelte ids", async () => {
    const text = `version: 1
language: de
templates: []
customers:
  - id: a
    name: A
    projects:
      - id: p
        name: P
        firewalls:
          - { hetzner_id: 1, template: fehlt }
  - id: a
    name: A2
`;
    const { store } = await storeWith(text);
    const e = (await store.load().catch((x) => x)) as ConfigError;
    expect(e.problems).toEqual(['Kunde "a" ist doppelt', 'Firewall 1 in a/p verweist auf unbekannte Vorlage "fehlt"']);
  });
});
