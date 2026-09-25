import { beforeEach, describe, expect, it } from "vitest";
import { FakeHetzner, server } from "../testing/fake-hetzner";
import { MemoryFiles, MemorySecrets } from "../testing/memory";
import { SecretStoreError } from "../ports";
import type { Firewall, FirewallRule } from "../hetzner/types";
import { AppService } from "./service";
import { firewallKey } from "./overview";

const any = ["0.0.0.0/0", "::/0"];
const rule = (protocol: FirewallRule["protocol"], port: string | null, src: string[], d: string | null = null): FirewallRule => ({
  direction: "in", protocol, port, source_ips: src, destination_ips: [], description: d,
});
const full = (src: string[]) => [rule("tcp", "1-65535", src), rule("udp", "1-65535", src), rule("icmp", null, src)];

function handmade(id: number): Firewall {
  return {
    id,
    name: "web-fw",
    labels: { env: "prod" },
    rules: [rule("tcp", "80", any), rule("tcp", "443", any), ...full(["203.0.113.99/32"]), rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde")],
    applied_to: [],
  };
}

let api: FakeHetzner;
let files: MemoryFiles;
let secrets: MemorySecrets;
let svc: AppService;

function makeService() {
  return new AppService(
    { fetch: api.fetch, files, secrets, now: () => new Date("2026-09-24T12:00:00Z") },
    { client: { sleep: async () => {}, actionPollMs: 0 } },
  );
}

beforeEach(() => {
  api = new FakeHetzner();
  files = new MemoryFiles();
  secrets = new MemorySecrets();
  svc = makeService();
});

async function setupManaged() {
  api.project("tok-web", { firewalls: [handmade(10)], servers: [server(1, "web1", [10]), server(2, "db1")] });
  await svc.start();
  await svc.initConfig("de");
  const { customerId, projectId } = await svc.addProject({ customerName: "Privat", projectName: "Webserver", token: "tok-web" });
  await svc.refreshProject(customerId, projectId);
  const fw = svc.getState().overview!.projects[0]!.unmanaged[0]!;
  const assignment = svc.suggest("standard", fw);
  const key = await svc.manageFirewall({ customerId, projectId, firewall: fw, templateId: "standard", assignment });
  return { customerId, projectId, key };
}

describe("AppService", () => {
  it("first run", async () => {
    await svc.start();
    expect(svc.getState().phase).toBe("first-run");
    await svc.initConfig("en");
    expect(svc.getState().phase).toBe("ready");
    expect(files.files.get("config.yaml")).toContain("name: Public web");
  });

  it("kaputte config", async () => {
    files.files.set("config.yaml", "version: 2\n");
    await svc.start();
    expect(svc.getState().phase).toBe("config-error");
    expect(files.files.get("config.yaml")).toBe("version: 2\n");
  });

  it("token nicht in config", async () => {
    await svc.start();
    await svc.initConfig("de");
    await svc.addProject({ customerName: "Kunde X", projectName: "Shop", token: " tok-shop \n" });
    expect(secrets.values.get("hfenceline/kunde-x/shop")).toBe("tok-shop");
    expect(files.files.get("config.yaml")).not.toContain("tok-shop");
  });

  it("kein keyring", async () => {
    class NoKeyring extends MemorySecrets {
      override async set(key: string, value: string, opts?: { allowFile?: boolean }) {
        if (!opts?.allowFile) throw new SecretStoreError("no-keyring", "no-keyring: kein Secret Service");
        await super.set(key, value);
      }
    }
    secrets = new NoKeyring();
    svc = makeService();
    await svc.start();
    await svc.initConfig("de");
    await expect(svc.addProject({ customerName: "Privat", projectName: "Web", token: "t" })).rejects.toMatchObject({ code: "no-keyring" });
    expect(svc.getState().config!.customers).toEqual([]);
    await svc.addProject({ customerName: "Privat", projectName: "Web", token: "t" }, { allowFile: true });
    expect(svc.getState().config!.customers[0]!.projects.map((p) => p.id)).toEqual(["web"]);
    expect(secrets.values.get("hfenceline/privat/web")).toBe("t");
  });

  it("prüft Tokens auf Schreibrecht", async () => {
    api.project("tok-rw");
    api.project("ro-tok");
    expect(await svc.checkToken("tok-rw")).toEqual({ valid: true, writable: true });
    expect(await svc.checkToken("ro-tok")).toMatchObject({ valid: true, writable: false });
    expect(await svc.checkToken("falsch")).toMatchObject({ valid: false });
  });

  it("server ohne fw", async () => {
    api.project("tok-web", { firewalls: [handmade(10)], servers: [server(1, "web1", [10]), server(2, "db1")] });
    await svc.start();
    await svc.initConfig("de");
    await svc.addProject({ customerName: "Privat", projectName: "Webserver", token: "tok-web" });
    await svc.refreshAll();
    const p = svc.getState().overview!.projects[0]!;
    expect(p.unmanaged.map((f) => f.id)).toEqual([10]);
    expect(p.unprotected.map((s) => s.name)).toEqual(["db1"]);
    expect(p.onlyUnmanaged.map((s) => s.name)).toEqual(["web1"]);
    expect(svc.getState().overview!.trayColor).toBe("yellow");
  });

  it("import + apply", async () => {
    const { key } = await setupManaged();
    const view = svc.getState().overview!.firewalls[0]!;
    expect(view.plan!.status.inSync).toBe(false);

    const result = await svc.applyFirewall(key);
    expect(result).toMatchObject({ ok: true });

    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    expect(fw.labels).toEqual({ env: "prod", "managed-by": "hfenceline" });
    expect(fw.rules.filter((r) => r.description?.startsWith("hfl:admin")).every((r) => r.source_ips[0] === "203.0.113.7/32")).toBe(true);
    expect(fw.rules).toContainEqual(rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde"));
    expect(fw.rules.some((r) => r.source_ips.includes("203.0.113.99/32"))).toBe(false);

    const after = svc.getState().overview!.firewalls[0]!;
    expect(after.states).toEqual(["foreign"]);
    const log = await svc.auditEntries();
    expect(log.map((e) => e.action)).toEqual(["set_rules", "labels"]);
    expect(log[0]!.old_rules).toHaveLength(6);
  });

  it("home-ip wechsel", async () => {
    const { key, customerId, projectId } = await setupManaged();
    await svc.applyFirewall(key);
    await svc.updateConfig((c) => {
      c.homeip.last_applied = "203.0.113.7";
    });
    api.projects.get("tok-web")!.servers = [server(1, "web1", [10]), server(2, "db1", [10])];
    await svc.refreshProject(customerId, projectId);
    expect(svc.getState().overview!.trayColor).toBe("green");

    api.homeIp = "198.51.100.77";
    await svc.refreshHomeIp();
    expect(svc.getState().overview!.homeIpChanged).toBe(true);
    expect(svc.getState().overview!.trayColor).toBe("red");
    expect(svc.getState().overview!.homeIpTargets.map((f) => f.key)).toEqual([key]);

    const results = await svc.applyHomeIp();
    expect(results).toMatchObject([{ key, ok: true, added: 3, removed: 3 }]);
    expect(svc.getState().config!.homeip.last_applied).toBe("198.51.100.77");
    expect(svc.getState().overview!.trayColor).toBe("green");
    expect((await svc.auditEntries())[0]).toMatchObject({ trigger: "home-ip", result: "ok" });
  });

  it("home-ip only", async () => {
    const { key } = await setupManaged();
    await svc.applyFirewall(key);
    await svc.updateConfig((c) => {
      c.customers[0]!.projects[0]!.firewalls[0]!.blocks = { ping: true };
    });
    api.homeIp = "198.51.100.77";
    await svc.refreshHomeIp();
    await svc.applyHomeIp();
    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    expect(fw.rules.some((r) => r.description === "hfl:ping Ping")).toBe(false);
    expect(svc.getState().overview!.firewalls[0]!.states).toContain("drifted");
  });

  it("fehlschlag + retry", async () => {
    const { key } = await setupManaged();
    await svc.applyFirewall(key);
    api.homeIp = "198.51.100.77";
    await svc.refreshHomeIp();
    api.failSetRules.add(10);
    const [r] = await svc.applyHomeIp();
    expect(r).toMatchObject({ ok: false });
    expect(r!.error).toContain("firewall resource not found");
    expect(svc.getState().config!.homeip.last_applied).not.toBe("198.51.100.77");
    expect((await svc.auditEntries())[0]).toMatchObject({ result: "error" });

    api.failSetRules.clear();
    const [again] = await svc.applyHomeIp([key]);
    expect(again).toMatchObject({ ok: true });
    expect(svc.getState().config!.homeip.last_applied).toBe("198.51.100.77");
  });

  it("neue firewall", async () => {
    api.project("tok-web", { servers: [server(1, "web1")] });
    await svc.start();
    await svc.initConfig("de");
    const { customerId, projectId } = await svc.addProject({ customerName: "Privat", projectName: "Webserver", token: "tok-web" });
    await svc.refreshHomeIp();
    const created = await svc.createFirewall({
      customerId,
      projectId,
      name: "webserver-standard",
      templateId: "standard",
      settings: { blocks: { ping: true }, static_ips: [{ cidr: "192.0.2.0/24", note: "Büro" }] },
    });
    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    expect(fw.labels).toEqual({ "managed-by": "hfenceline" });
    expect(new Set(fw.rules.map((r) => r.description))).toEqual(
      new Set(["hfl:web Web öffentlich", "hfl:admin Admin von zu Hause", "hfl:static Feste IPs", "hfl:ping Ping"]),
    );
    expect(svc.getState().config!.customers[0]!.projects[0]!.firewalls).toEqual([
      { hetzner_id: created.id, template: "standard", blocks: { ping: true }, static_ips: [{ cidr: "192.0.2.0/24", note: "Büro" }] },
    ]);
    await svc.refreshProject(customerId, projectId);
    expect(svc.getState().overview!.firewalls[0]!.state).toBe("ok");
    expect((await svc.auditEntries())[0]).toMatchObject({ action: "create", firewall_id: created.id });
  });

  it("fremde regel übernehmen", async () => {
    const { key } = await setupManaged();
    await svc.applyFirewall(key);
    const foreign = rule("tcp", "5432", ["198.51.100.20/32"], "Postgres Kunde");

    await svc.setForeignChoice(key, foreign, "adopt");
    expect(svc.getState().config!.customers[0]!.projects[0]!.firewalls[0]!.extra_rules).toEqual([
      { name: "Postgres Kunde", protocol: "tcp", port: "5432", from: ["198.51.100.20/32"] },
    ]);
    await svc.applyFirewall(key);
    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    expect(fw.rules.filter((r) => r.port === "5432")).toEqual([rule("tcp", "5432", ["198.51.100.20/32"], "hfl:extra Postgres Kunde")]);
    expect(svc.getState().overview!.firewalls[0]!.states).toEqual(["ok"]);
  });

  it("ist ins soll", async () => {
    const { key } = await setupManaged();
    await svc.applyFirewall(key);
    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    fw.rules.push(rule("icmp", null, any, "hfl:ping Ping"));
    await svc.refreshAll();
    expect(svc.getState().overview!.firewalls[0]!.states).toContain("drifted");
    await svc.adoptActual(key);
    expect(svc.getState().config!.customers[0]!.projects[0]!.firewalls[0]!.blocks).toEqual({ ping: true });
    expect(svc.getState().overview!.firewalls[0]!.states).toEqual(["foreign"]);
  });

  it("unmanage", async () => {
    const { key } = await setupManaged();
    await svc.applyFirewall(key);
    const rulesBefore = api.projects.get("tok-web")!.firewalls[0]!.rules;
    await svc.unmanageFirewall(key);
    const fw = api.projects.get("tok-web")!.firewalls[0]!;
    expect(fw.labels).toEqual({ env: "prod" });
    expect(fw.rules).toEqual(rulesBefore);
    expect(svc.getState().config!.customers[0]!.projects[0]!.firewalls).toEqual([]);
  });

  it("token ungültig", async () => {
    const { customerId, projectId } = await setupManaged();
    await secrets.set("hfenceline/privat/webserver", "falsch");
    await svc.refreshProject(customerId, projectId);
    const o = svc.getState().overview!;
    expect(o.projects[0]!.state).toBe("unreachable");
    expect(o.firewalls[0]!.state).toBe("unreachable");
    expect(o.trayColor).toBe("red");
    expect(firewallKey(customerId, projectId, 10)).toBe(o.firewalls[0]!.key);
  });

  it("fw gelöscht", async () => {
    const { customerId, projectId } = await setupManaged();
    api.projects.get("tok-web")!.firewalls = [];
    await svc.refreshProject(customerId, projectId);
    expect(svc.getState().overview!.firewalls[0]!.error).toMatchObject({ code: "not_found" });
  });
});
