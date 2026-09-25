import type { ManagedFirewall, Template } from "../model/config";
import { SOURCE_HOME } from "../model/config";
import type { FirewallRule } from "../hetzner/types";
import { desiredOwnedRules } from "./plan";
import { blockUsesHome, diffRules, EXTRA_RULE_ID, isOwned, ownerId } from "./rules";

export function homeIpOnlyRules(
  template: Template,
  firewall: ManagedFirewall,
  actual: FirewallRule[],
  homeIp: string,
): { rules: FirewallRule[]; added: FirewallRule[]; removed: FirewallRule[] } {
  const ids = new Set(template.blocks.filter(blockUsesHome).map((b) => b.id));
  if ((firewall.extra_rules ?? []).some((r) => r.from.includes(SOURCE_HOME))) ids.add(EXTRA_RULE_ID);
  const touched = (r: FirewallRule) => isOwned(r) && ids.has(ownerId(r) ?? "");
  const desired = desiredOwnedRules(template, firewall, homeIp).filter(touched);
  const rules = [...desired, ...actual.filter((r) => !touched(r))];
  return { rules, ...diffRules(actual, rules) };
}
