import type { ManagedFirewall, Template } from "../model/config";
import type { FirewallRule } from "../hetzner/types";
import { MAX_EFFECTIVE_RULES } from "../hetzner/types";
import { cidrContains, hostCidr, isAnySource } from "../net/ip";
import {
  atomKey,
  blockUsesHome,
  diffRules,
  effectiveRuleCount,
  expandBlock,
  expandExtraRule,
  isOwned,
  ownerId,
  ruleAtoms,
  ruleKey,
  type ExpandContext,
} from "./rules";

export interface PlanInput {
  template: Template;
  firewall: ManagedFirewall;
  actual: FirewallRule[];
  homeIp: string | null;
  dropForeign?: ReadonlySet<string>;
}

export interface ForeignRule {
  key: string;
  rule: FirewallRule;
  drop: boolean;
}

export type PlanWarning =
  | "lockout"
  | "rule-limit"
  | "no-home-ip"
  | "no-rules";

export interface PlanStatus {
  inSync: boolean;
  homeIpOutdated: boolean;
  drifted: boolean;
  hasForeign: boolean;
}

export interface PlanResult {
  rules: FirewallRule[];
  owned: FirewallRule[];
  foreign: ForeignRule[];
  added: FirewallRule[];
  removed: FirewallRule[];
  status: PlanStatus;
  warnings: PlanWarning[];
  activeBlocks: string[];
}

export function isBlockActive(template: Template, firewall: ManagedFirewall, blockId: string): boolean {
  const block = template.blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (!block.optional) return true;
  return firewall.blocks?.[blockId] ?? block.default ?? false;
}

export function desiredOwnedRules(template: Template, firewall: ManagedFirewall, homeIp: string | null): FirewallRule[] {
  const ctx: ExpandContext = {
    homeIp,
    staticCidrs: (firewall.static_ips ?? []).map((s) => s.cidr),
  };
  const fromBlocks = template.blocks
    .filter((b) => isBlockActive(template, firewall, b.id))
    .flatMap((b) => expandBlock(b, ctx));
  const extras = (firewall.extra_rules ?? []).flatMap((r) => expandExtraRule(r, ctx));
  return [...fromBlocks, ...extras];
}

export function plan(input: PlanInput): PlanResult {
  const { template, firewall, actual, homeIp } = input;
  const drop = input.dropForeign ?? new Set<string>();

  const activeBlocks = template.blocks.filter((b) => isBlockActive(template, firewall, b.id));
  const owned = desiredOwnedRules(template, firewall, homeIp);

  const foreign: ForeignRule[] = actual
    .filter((r) => !isOwned(r))
    .map((rule) => {
      const key = ruleKey(rule);
      return { key, rule, drop: drop.has(key) };
    });
  const kept = foreign.filter((f) => !f.drop).map((f) => f.rule);
  const rules = [...owned, ...kept];

  const { added, removed } = diffRules(actual, rules);
  const inSync = added.length === 0 && removed.length === 0;

  const homeUsed = activeBlocks.some(blockUsesHome);
  const homeCidr = homeIp ? hostCidr(homeIp) : null;
  const actualAtoms = new Set(actual.filter(isOwned).flatMap(ruleAtoms).map(atomKey));
  const homeAtoms = homeCidr
    ? owned.flatMap(ruleAtoms).filter((a) => a.source === homeCidr)
    : [];
  const homeIpOutdated = homeAtoms.some((a) => !actualAtoms.has(atomKey(a)));

  const status: PlanStatus = {
    inSync,
    homeIpOutdated,
    drifted: !inSync && !onlyHomeIpDiffers(template, added, removed, homeCidr),
    hasForeign: foreign.length > 0,
  };

  const warnings: PlanWarning[] = [];
  if (homeUsed && !homeIp) warnings.push("no-home-ip");
  if (homeIp && !rules.some((r) => grantsHomeIp(r, homeIp))) warnings.push("lockout");
  if (effectiveRuleCount(rules) > MAX_EFFECTIVE_RULES) warnings.push("rule-limit");
  if (!rules.some((r) => r.direction === "in")) warnings.push("no-rules");

  return {
    rules,
    owned,
    foreign,
    added,
    removed,
    status,
    warnings,
    activeBlocks: activeBlocks.map((b) => b.id),
  };
}

function grantsHomeIp(rule: FirewallRule, homeIp: string): boolean {
  return (
    rule.direction === "in" &&
    rule.source_ips.some((s) => !isAnySource(s) && cidrContains(s, homeIp))
  );
}

function onlyHomeIpDiffers(
  template: Template,
  added: FirewallRule[],
  removed: FirewallRule[],
  homeCidr: string | null,
): boolean {
  if (!homeCidr || added.length !== removed.length) return false;
  const homeBlocks = new Set(template.blocks.filter(blockUsesHome).map((b) => b.id));
  const strip = (r: FirewallRule, source: string) =>
    ruleKey({ ...r, source_ips: r.source_ips.filter((s) => s !== source) });
  const pool = removed.filter((r) => isOwned(r) && homeBlocks.has(ownerId(r) ?? ""));
  if (pool.length !== removed.length) return false;
  for (const a of added) {
    if (!isOwned(a) || !homeBlocks.has(ownerId(a) ?? "") || !a.source_ips.includes(homeCidr)) return false;
    const target = strip(a, homeCidr);
    const idx = pool.findIndex((r) =>
      r.source_ips.some((s) => s.endsWith("/32") && s !== homeCidr && strip(r, s) === target),
    );
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return pool.length === 0;
}
