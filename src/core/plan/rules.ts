import type { Block, ExtraRule, RuleSpec } from "../model/config";
import { SOURCE_ANY, SOURCE_HOME, SOURCE_STATIC } from "../model/config";
import type { FirewallRule, HetznerProtocol } from "../hetzner/types";
import { ANY_IPV4, ANY_IPV6, hostCidr, isAnySource, normalizeCidr } from "../net/ip";

export const FULL_PORT_RANGE = "1-65535";
export const DESCRIPTION_PREFIX = "hfl:";
export const EXTRA_RULE_ID = "extra";
const MAX_DESCRIPTION = 255;

export interface ExpandContext {
  homeIp: string | null;
  staticCidrs: string[];
}

export function ownedDescription(id: string, name: string): string {
  return `${DESCRIPTION_PREFIX}${id} ${name}`.slice(0, MAX_DESCRIPTION);
}

export function isOwned(rule: FirewallRule): boolean {
  return rule.direction === "in" && (rule.description ?? "").startsWith(DESCRIPTION_PREFIX);
}

export function ownerId(rule: FirewallRule): string | undefined {
  const d = rule.description ?? "";
  if (!d.startsWith(DESCRIPTION_PREFIX)) return undefined;
  return d.slice(DESCRIPTION_PREFIX.length).split(" ", 1)[0] || undefined;
}

export function ownerName(rule: FirewallRule): string {
  const d = rule.description ?? "";
  const space = d.indexOf(" ");
  return space >= 0 ? d.slice(space + 1) : d;
}

export function resolveSources(from: string[], ctx: ExpandContext): string[] {
  const out: string[] = [];
  for (const f of from) {
    if (f === SOURCE_ANY) out.push(ANY_IPV4, ANY_IPV6);
    else if (f === SOURCE_HOME) {
      if (ctx.homeIp) out.push(hostCidr(ctx.homeIp));
    } else if (f === SOURCE_STATIC) out.push(...ctx.staticCidrs);
    else out.push(f);
  }
  return uniqueSorted(out.map(normalizeCidr));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareCidr);
}

function compareCidr(a: string, b: string): number {
  const v6a = a.includes(":");
  const v6b = b.includes(":");
  if (v6a !== v6b) return v6a ? 1 : -1;
  if (!v6a) {
    const na = a.split(/[./]/).map(Number);
    const nb = b.split(/[./]/).map(Number);
    for (let i = 0; i < 5; i++) {
      const d = (na[i] ?? 0) - (nb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function expandRuleSpec(spec: RuleSpec, ctx: ExpandContext, description: string): FirewallRule[] {
  const sources = resolveSources(spec.from, ctx);
  if (sources.length === 0) return [];
  const make = (protocol: HetznerProtocol, port: string | null): FirewallRule => ({
    direction: "in",
    protocol,
    port,
    source_ips: sources,
    destination_ips: [],
    description,
  });
  switch (spec.protocol) {
    case "all":
      return [make("tcp", FULL_PORT_RANGE), make("udp", FULL_PORT_RANGE), make("icmp", null)];
    case "tcp":
    case "udp":
      return [make(spec.protocol, spec.port ?? FULL_PORT_RANGE)];
    default:
      return [make(spec.protocol, null)];
  }
}

export function expandBlock(block: Block, ctx: ExpandContext): FirewallRule[] {
  const desc = ownedDescription(block.id, block.name);
  return block.rules.flatMap((r) => expandRuleSpec(r, ctx, desc));
}

export function expandExtraRule(rule: ExtraRule, ctx: ExpandContext): FirewallRule[] {
  return expandRuleSpec(rule, ctx, ownedDescription(EXTRA_RULE_ID, rule.name));
}

export function blockUsesHome(block: Block): boolean {
  return block.rules.some((r) => r.from.includes(SOURCE_HOME));
}

export function normalizePort(protocol: string, port: string | null | undefined): string | null {
  if (protocol !== "tcp" && protocol !== "udp") return null;
  if (!port || port === "any") return FULL_PORT_RANGE;
  const m = /^(\d+)-(\d+)$/.exec(port);
  if (m && m[1] === m[2]) return m[1]!;
  return port;
}

export function normalizeRule(rule: FirewallRule): FirewallRule {
  return {
    direction: rule.direction,
    protocol: rule.protocol,
    port: normalizePort(rule.protocol, rule.port),
    source_ips: uniqueSorted(rule.source_ips.map(normalizeCidr)),
    destination_ips: uniqueSorted(rule.destination_ips.map(normalizeCidr)),
    description: rule.description ?? "",
  };
}

export function ruleKey(rule: FirewallRule): string {
  const r = normalizeRule(rule);
  return [r.direction, r.protocol, r.port ?? "", r.source_ips.join(","), r.destination_ips.join(","), r.description].join("|");
}

export interface Atom {
  protocol: HetznerProtocol;
  port: string | null;
  source: string;
}

export function atomKey(a: Atom): string {
  return `${a.protocol}|${a.port ?? ""}|${a.source}`;
}

export function ruleAtoms(rule: FirewallRule): Atom[] {
  if (rule.direction !== "in") return [];
  const r = normalizeRule(rule);
  return r.source_ips.map((source) => ({ protocol: r.protocol, port: r.port ?? null, source }));
}

export function diffRules(
  actual: FirewallRule[],
  desired: FirewallRule[],
): { added: FirewallRule[]; removed: FirewallRule[] } {
  const remaining = new Map<string, number>();
  for (const r of actual) {
    const k = ruleKey(r);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const added: FirewallRule[] = [];
  for (const r of desired) {
    const k = ruleKey(r);
    const n = remaining.get(k) ?? 0;
    if (n > 0) remaining.set(k, n - 1);
    else added.push(r);
  }
  const removed: FirewallRule[] = [];
  const toRemove = new Map(remaining);
  for (const r of actual) {
    const k = ruleKey(r);
    const n = toRemove.get(k) ?? 0;
    if (n > 0) {
      removed.push(r);
      toRemove.set(k, n - 1);
    }
  }
  return { added, removed };
}

export function effectiveRuleCount(rules: FirewallRule[]): number {
  return rules.reduce((n, r) => n + Math.max(1, r.source_ips.length + r.destination_ips.length), 0);
}

export function sourcesToFrom(sources: string[]): string[] {
  const norm = sources.map(normalizeCidr);
  const hasAny4 = norm.includes(ANY_IPV4);
  const hasAny6 = norm.includes(ANY_IPV6);
  const rest = norm.filter((s) => !isAnySource(s));
  const out = hasAny4 && hasAny6 ? [SOURCE_ANY] : norm.filter(isAnySource);
  return [...out, ...rest];
}
