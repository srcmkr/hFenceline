import { describe, expect, it } from "vitest";
import { standardTemplate } from "../model/defaults";
import type { FirewallRule } from "../hetzner/types";
import { homeIpOnlyRules } from "./home";

const T = standardTemplate("de");
const rule = (protocol: FirewallRule["protocol"], port: string | null, src: string[], d: string | null): FirewallRule => ({
  direction: "in", protocol, port, source_ips: src, destination_ips: [], description: d,
});
const admin = (ip: string) => [
  rule("tcp", "1-65535", [`${ip}/32`], "hfl:admin Admin von zu Hause"),
  rule("udp", "1-65535", [`${ip}/32`], "hfl:admin Admin von zu Hause"),
  rule("icmp", null, [`${ip}/32`], "hfl:admin Admin von zu Hause"),
];

describe("homeIpOnlyRules", () => {
  it("nur home-ip", () => {
    const handEdited = rule("tcp", "8080", ["0.0.0.0/0", "::/0"], "hfl:web Web öffentlich");
    const foreign = rule("tcp", "22", ["198.51.100.1/32"], null);
    const actual = [handEdited, ...admin("203.0.113.99"), foreign];
    const r = homeIpOnlyRules(T, { hetzner_id: 1, template: "standard", blocks: { ping: true } }, actual, "203.0.113.7");
    expect(r.rules).toContainEqual(handEdited);
    expect(r.rules).toContainEqual(foreign);
    expect(r.rules.some((x) => x.description === "hfl:ping Ping")).toBe(false);
    expect(r.added).toEqual(admin("203.0.113.7"));
    expect(r.removed).toEqual(admin("203.0.113.99"));
  });

  it("ergänzt fehlende Home-IP-Regeln", () => {
    const r = homeIpOnlyRules(T, { hetzner_id: 1, template: "standard" }, [], "203.0.113.7");
    expect(r.rules).toEqual(admin("203.0.113.7"));
  });
});
