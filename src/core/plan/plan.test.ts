import { describe, expect, it } from "vitest";
import type { ManagedFirewall, Template } from "../model/config";
import { standardTemplate } from "../model/defaults";
import type { FirewallRule } from "../hetzner/types";
import { plan, desiredOwnedRules } from "./plan";
import { diffRules, effectiveRuleCount, normalizePort, ruleKey } from "./rules";

const HOME = "203.0.113.7";
const OLD_HOME = "203.0.113.99";
const T: Template = standardTemplate("de");
const FW: ManagedFirewall = { hetzner_id: 1, template: "standard" };

const any = ["0.0.0.0/0", "::/0"];

function rule(protocol: FirewallRule["protocol"], port: string | null, sources: string[], description: string | null): FirewallRule {
  return { direction: "in", protocol, port, source_ips: sources, destination_ips: [], description };
}

function web(desc = "hfl:web Web öffentlich") {
  return [rule("tcp", "80", any, desc), rule("tcp", "443", any, desc)];
}
function full(sources: string[], desc: string) {
  return [
    rule("tcp", "1-65535", sources, desc),
    rule("udp", "1-65535", sources, desc),
    rule("icmp", null, sources, desc),
  ];
}
const admin = (ip = HOME) => full([`${ip}/32`], "hfl:admin Admin von zu Hause");
const ping = () => [rule("icmp", null, any, "hfl:ping Ping")];

describe("desiredOwnedRules", () => {
  it("standardvorlage", () => {
    const rules = desiredOwnedRules(T, FW, HOME);
    expect(rules.map(ruleKey).sort()).toEqual([...web(), ...admin()].map(ruleKey).sort());
  });

  it("all -> tcp/udp/icmp", () => {
    const rules = desiredOwnedRules(T, FW, HOME).filter((r) => r.description?.startsWith("hfl:admin"));
    expect(rules.map((r) => [r.protocol, r.port])).toEqual([
      ["tcp", "1-65535"],
      ["udp", "1-65535"],
      ["icmp", null],
    ]);
  });

  it("feste ips", () => {
    const fw: ManagedFirewall = {
      ...FW,
      static_ips: [{ cidr: "198.51.100.10/32", note: "Büro" }, { cidr: "192.0.2.0/24" }],
    };
    const statics = desiredOwnedRules(T, fw, HOME).filter((r) => r.description?.startsWith("hfl:static"));
    expect(statics).toHaveLength(3);
    expect(statics[0]!.source_ips).toEqual(["192.0.2.0/24", "198.51.100.10/32"]);
  });

  it("zuschaltbar", () => {
    const on = desiredOwnedRules(T, { ...FW, blocks: { ping: true } }, HOME);
    expect(on.some((r) => r.description === "hfl:ping Ping")).toBe(true);
    const off = desiredOwnedRules(T, { ...FW, blocks: { ping: false } }, HOME);
    expect(off.some((r) => r.description === "hfl:ping Ping")).toBe(false);
  });

  it("nicht zuschaltbar", () => {
    const rules = desiredOwnedRules(T, { ...FW, blocks: { web: false } }, HOME);
    expect(rules.some((r) => r.description?.startsWith("hfl:web"))).toBe(true);
  });

  it("zusatzregeln", () => {
    const fw: ManagedFirewall = {
      ...FW,
      extra_rules: [{ name: "Monitoring", protocol: "tcp", port: "9100", from: ["192.0.2.5/32"] }],
    };
    const extra = desiredOwnedRules(T, fw, HOME).filter((r) => r.description === "hfl:extra Monitoring");
    expect(extra).toEqual([rule("tcp", "9100", ["192.0.2.5/32"], "hfl:extra Monitoring")]);
  });

  it("home-ip unbekannt", () => {
    const rules = desiredOwnedRules(T, FW, null);
    expect(rules.some((r) => r.description?.startsWith("hfl:admin"))).toBe(false);
  });
});

describe("plan", () => {
  const cases: {
    name: string;
    fw?: ManagedFirewall;
    actual: FirewallRule[];
    homeIp?: string | null;
    expect: {
      inSync: boolean;
      homeIpOutdated: boolean;
      drifted: boolean;
      hasForeign: boolean;
      warnings?: string[];
      added?: number;
      removed?: number;
    };
  }[] = [
    {
      name: "in sync",
      actual: [...web(), ...admin()],
      expect: { inSync: true, homeIpOutdated: false, drifted: false, hasForeign: false, warnings: [] },
    },
    {
      name: "reihenfolge egal",
      actual: [...admin().reverse(), rule("tcp", "443-443", ["::/0", "0.0.0.0/0"], "hfl:web Web öffentlich"), rule("tcp", "80", any, "hfl:web Web öffentlich")],
      expect: { inSync: true, homeIpOutdated: false, drifted: false, hasForeign: false },
    },
    {
      name: "alte home-ip",
      actual: [...web(), ...admin(OLD_HOME)],
      expect: { inSync: false, homeIpOutdated: true, drifted: false, hasForeign: false, added: 3, removed: 3 },
    },
    {
      name: "leer",
      actual: [],
      expect: { inSync: false, homeIpOutdated: true, drifted: true, hasForeign: false, added: 5, removed: 0 },
    },
    {
      name: "hfl-regel geändert",
      actual: [rule("tcp", "8080", any, "hfl:web Web öffentlich"), web()[1]!, ...admin()],
      expect: { inSync: false, homeIpOutdated: false, drifted: true, hasForeign: false, added: 1, removed: 1 },
    },
    {
      name: "baustein umbenannt",
      actual: [...web("hfl:web Web"), ...admin()],
      expect: { inSync: false, homeIpOutdated: false, drifted: true, hasForeign: false, added: 2, removed: 2 },
    },
    {
      name: "alte home-ip + geändert",
      actual: [web()[0]!, ...admin(OLD_HOME)],
      expect: { inSync: false, homeIpOutdated: true, drifted: true, hasForeign: false },
    },
    {
      name: "fremde regeln",
      actual: [...web(), ...admin(), rule("tcp", "22", ["198.51.100.1/32"], "SSH Kollege"), rule("tcp", "25", any, null)],
      expect: { inSync: true, homeIpOutdated: false, drifted: false, hasForeign: true },
    },
    {
      name: "ausgehend = fremd",
      actual: [
        ...web(),
        ...admin(),
        { direction: "out", protocol: "tcp", port: "25", source_ips: [], destination_ips: any, description: "hfl:web trick" },
      ],
      expect: { inSync: true, homeIpOutdated: false, drifted: false, hasForeign: true },
    },
    {
      name: "ping fehlt",
      fw: { ...FW, blocks: { ping: true } },
      actual: [...web(), ...admin()],
      expect: { inSync: false, homeIpOutdated: false, drifted: true, hasForeign: false, added: 1, removed: 0 },
    },
    {
      name: "ping zu viel",
      actual: [...web(), ...admin(), ...ping()],
      expect: { inSync: false, homeIpOutdated: false, drifted: true, hasForeign: false, added: 0, removed: 1 },
    },
    {
      name: "home-ip unbekannt",
      homeIp: null,
      actual: [...web(), ...admin()],
      expect: { inSync: false, homeIpOutdated: false, drifted: true, hasForeign: false, warnings: ["no-home-ip"] },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = plan({ template: T, firewall: c.fw ?? FW, actual: c.actual, homeIp: c.homeIp === undefined ? HOME : c.homeIp });
      const { inSync, homeIpOutdated, drifted, hasForeign } = result.status;
      expect({ inSync, homeIpOutdated, drifted, hasForeign }).toEqual({
        inSync: c.expect.inSync,
        homeIpOutdated: c.expect.homeIpOutdated,
        drifted: c.expect.drifted,
        hasForeign: c.expect.hasForeign,
      });
      if (c.expect.warnings) expect(result.warnings).toEqual(c.expect.warnings);
      if (c.expect.added !== undefined) expect(result.added).toHaveLength(c.expect.added);
      if (c.expect.removed !== undefined) expect(result.removed).toHaveLength(c.expect.removed);
    });
  }

  it("fremde regeln bleiben", () => {
    const foreign = rule("tcp", "22", ["198.51.100.1/32"], "SSH Kollege");
    const result = plan({ template: T, firewall: FW, actual: [foreign, ...admin(OLD_HOME)], homeIp: HOME });
    expect(result.rules).toContainEqual(foreign);
    expect(result.foreign).toEqual([{ key: ruleKey(foreign), rule: foreign, drop: false }]);
  });

  it("fremde regel droppen", () => {
    const foreign = rule("tcp", "22", ["198.51.100.1/32"], "SSH Kollege");
    const result = plan({
      template: T,
      firewall: FW,
      actual: [...web(), ...admin(), foreign],
      homeIp: HOME,
      dropForeign: new Set([ruleKey(foreign)]),
    });
    expect(result.rules).not.toContainEqual(foreign);
    expect(result.removed).toEqual([foreign]);
    expect(result.foreign[0]!.drop).toBe(true);
  });

  it("lockout", () => {
    const noAdmin: Template = { ...T, blocks: T.blocks.filter((b) => b.id !== "admin") };
    const result = plan({ template: noAdmin, firewall: FW, actual: [...web(), ...admin()], homeIp: HOME });
    expect(result.warnings).toContain("lockout");
  });

  it("lockout: netz mit home-ip", () => {
    const noAdmin: Template = { ...T, blocks: T.blocks.filter((b) => b.id !== "admin") };
    const fw: ManagedFirewall = { ...FW, static_ips: [{ cidr: "203.0.113.0/24" }] };
    const result = plan({ template: noAdmin, firewall: fw, actual: [], homeIp: HOME });
    expect(result.warnings).not.toContain("lockout");
  });

  it("lockout: any zählt nicht", () => {
    const webOnly: Template = { ...T, blocks: T.blocks.filter((b) => b.id === "web") };
    const result = plan({ template: webOnly, firewall: FW, actual: [], homeIp: HOME });
    expect(result.warnings).toContain("lockout");
  });

  it("keine regeln", () => {
    const empty: Template = { ...T, blocks: [] };
    const result = plan({ template: empty, firewall: FW, actual: [], homeIp: HOME });
    expect(result.warnings).toContain("no-rules");
  });

  it("500 regeln", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ cidr: `10.0.${Math.floor(i / 250)}.${i % 250}/32` }));
    const result = plan({ template: T, firewall: { ...FW, static_ips: many }, actual: [], homeIp: HOME });
    expect(result.warnings).toContain("rule-limit");
  });

  it("reihenfolge", () => {
    const foreign = rule("tcp", "22", ["198.51.100.1/32"], null);
    const result = plan({ template: T, firewall: FW, actual: [foreign], homeIp: HOME });
    expect(result.rules.at(-1)).toEqual(foreign);
    expect(result.rules.slice(0, -1)).toEqual(result.owned);
  });
});

describe("rules", () => {
  it("normalisiert Ports", () => {
    expect(normalizePort("tcp", "80-80")).toBe("80");
    expect(normalizePort("tcp", "any")).toBe("1-65535");
    expect(normalizePort("udp", null)).toBe("1-65535");
    expect(normalizePort("icmp", "80")).toBeNull();
  });

  it("vergleicht als Multimenge", () => {
    const a = rule("tcp", "22", ["1.2.3.4/32"], null);
    const { added, removed } = diffRules([a, a], [a]);
    expect(added).toEqual([]);
    expect(removed).toEqual([a]);
  });

  it("zählt wirksame Regeln", () => {
    expect(effectiveRuleCount([...web(), ...admin()])).toBe(2 * 2 + 3);
  });
});
