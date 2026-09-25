import type { ExtraRule, ManagedFirewall, StaticIp, Template } from "../model/config";
import { SOURCE_HOME, SOURCE_STATIC } from "../model/config";
import type { FirewallRule } from "../hetzner/types";
import { hostCidr, isAnySource, normalizeCidr, parseCidr4 } from "../net/ip";
import {
  atomKey,
  blockUsesHome,
  expandBlock,
  FULL_PORT_RANGE,
  isOwned,
  normalizeRule,
  ownerId,
  ownerName,
  ruleAtoms,
  sourcesToFrom,
  type ExpandContext,
} from "./rules";

export interface AssignInput {
  template: Template;
  actual: FirewallRule[];
  homeIp: string | null;
  lastHomeIp?: string;
  homeSource?: string | null;
  previous?: ManagedFirewall;
}

export interface HomeCandidate {
  cidr: string;
  confident: boolean;
}

export interface AssignResult {
  settings: Pick<ManagedFirewall, "blocks" | "static_ips" | "extra_rules">;
  homeCandidate: HomeCandidate | null;
  fullAccessHosts: string[];
  covered: FirewallRule[];
  adopted: FirewallRule[];
  foreign: FirewallRule[];
}

function fullAccessSources(actual: FirewallRule[], template: Template): string[] {
  const addressBlocks = new Set(
    template.blocks
      .filter((b) => b.rules.some((r) => r.from.includes(SOURCE_HOME) || r.from.includes(SOURCE_STATIC)))
      .map((b) => b.id),
  );
  const seen = new Map<string, Set<string>>();
  for (const r of actual) {
    if (r.direction !== "in") continue;
    if (isOwned(r) && !addressBlocks.has(ownerId(r) ?? "")) continue;
    const n = normalizeRule(r);
    const kind =
      (n.protocol === "tcp" || n.protocol === "udp") && n.port === FULL_PORT_RANGE ? n.protocol : n.protocol === "icmp" ? "icmp" : null;
    if (!kind) continue;
    for (const s of n.source_ips) {
      if (isAnySource(s) || !parseCidr4(s)) continue;
      seen.set(s, (seen.get(s) ?? new Set()).add(kind));
    }
  }
  return [...seen].filter(([, kinds]) => kinds.size === 3).map(([s]) => s);
}

function soloHosts(rules: FirewallRule[]): string[] {
  const out = new Set<string>();
  for (const r of rules) {
    const n = normalizeRule(r);
    const only = n.source_ips[0];
    if (n.protocol === "tcp" && n.port === FULL_PORT_RANGE && n.source_ips.length === 1 && only?.endsWith("/32")) {
      out.add(only);
    }
  }
  return [...out];
}

export function suggestAssignment(input: AssignInput): AssignResult {
  const { template, actual, homeIp, lastHomeIp, previous } = input;
  const inRules = actual.filter((r) => r.direction === "in");
  const outRules = actual.filter((r) => r.direction !== "in");
  const actualAtoms = new Set(inRules.flatMap(ruleAtoms).map(atomKey));

  const full = fullAccessSources(inRules, template);
  const fullAccessHosts = full.filter((s) => s.endsWith("/32"));
  const templateUsesHome = template.blocks.some(blockUsesHome);

  let homeCandidate: HomeCandidate | null = null;
  if (input.homeSource !== undefined) {
    homeCandidate = input.homeSource ? { cidr: normalizeCidr(input.homeSource), confident: true } : null;
  } else if (templateUsesHome) {
    const known = [homeIp, lastHomeIp].filter((x): x is string => !!x).map(hostCidr);
    const match = known.find((k) => fullAccessHosts.includes(k));
    if (match) homeCandidate = { cidr: match, confident: true };
    else {
      const solo = soloHosts(inRules).filter((s) => fullAccessHosts.includes(s));
      const pick = solo.length === 1 ? solo : fullAccessHosts.length === 1 ? fullAccessHosts : [];
      if (pick[0]) homeCandidate = { cidr: pick[0], confident: false };
    }
  }

  const notes = new Map((previous?.static_ips ?? []).map((s) => [normalizeCidr(s.cidr), s.note]));
  const staticIps: StaticIp[] = full
    .filter((s) => s !== homeCandidate?.cidr)
    .map((cidr) => (notes.get(cidr) ? { cidr, note: notes.get(cidr) } : { cidr }));

  const ctx: ExpandContext = {
    homeIp: homeCandidate ? homeCandidate.cidr.replace(/\/32$/, "") : null,
    staticCidrs: staticIps.map((s) => s.cidr),
  };

  const blocks: Record<string, boolean> = {};
  const coveredAtoms = new Set<string>();
  for (const block of template.blocks) {
    const expanded = expandBlock(block, ctx);
    const atoms = expanded.flatMap(ruleAtoms).map(atomKey);
    const present = atoms.length > 0 && atoms.every((a) => actualAtoms.has(a));
    if (block.optional) {
      blocks[block.id] = present;
      if (!present) continue;
    }
    for (const a of atoms) coveredAtoms.add(a);
  }

  const covered: FirewallRule[] = [];
  const adopted: FirewallRule[] = [];
  const foreign: FirewallRule[] = [...outRules];
  for (const r of inRules) {
    const atoms = ruleAtoms(r).map(atomKey);
    if (atoms.length > 0 && atoms.every((a) => coveredAtoms.has(a))) covered.push(r);
    else if (isOwned(r) && ownerId(r) !== undefined) adopted.push(r);
    else foreign.push(r);
  }

  const extraRules = mergeExtraRules(adopted);

  const settings: AssignResult["settings"] = {};
  if (Object.keys(blocks).length > 0) settings.blocks = blocks;
  if (staticIps.length > 0) settings.static_ips = staticIps;
  if (extraRules.length > 0) settings.extra_rules = extraRules;

  return { settings, homeCandidate, fullAccessHosts, covered, adopted, foreign };
}

function mergeExtraRules(rules: FirewallRule[]): ExtraRule[] {
  const out: ExtraRule[] = [];
  const groups = new Map<string, FirewallRule[]>();
  for (const r of rules) {
    const n = normalizeRule(r);
    const k = `${ownerName(r)}|${n.source_ips.join(",")}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    const name = ownerName(first) || "?";
    const from = sourcesToFrom(first.source_ips);
    const tcp = group.findIndex((r) => r.protocol === "tcp" && r.port === FULL_PORT_RANGE);
    const udp = group.findIndex((r) => r.protocol === "udp" && r.port === FULL_PORT_RANGE);
    const icmp = group.findIndex((r) => r.protocol === "icmp");
    let rest = group;
    if (tcp >= 0 && udp >= 0 && icmp >= 0) {
      out.push({ name, protocol: "all", from });
      rest = group.filter((_, i) => i !== tcp && i !== udp && i !== icmp);
    }
    for (const r of rest) {
      const rule: ExtraRule = { name, protocol: r.protocol, from };
      if (r.port) rule.port = r.port;
      out.push(rule);
    }
  }
  return out;
}
