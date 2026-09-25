import { useTranslation } from "react-i18next";
import { Globe, House, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FirewallRule } from "@/core/hetzner/types";
import { ANY_IPV4, ANY_IPV6, normalizeCidr } from "@/core/net/ip";
import { FULL_PORT_RANGE, normalizePort } from "@/core/plan/rules";

export interface SourceContext {
  homeIp: string | null;
  notes?: Map<string, string | undefined>;
}

export function ProtocolBadge({ protocol }: { protocol: string }) {
  return (
    <span className="inline-flex h-5 min-w-11 items-center justify-center rounded-md bg-secondary px-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
      {protocol}
    </span>
  );
}

export function PortLabel({ rule }: { rule: FirewallRule }) {
  const { t } = useTranslation();
  const port = normalizePort(rule.protocol, rule.port);
  if (port === null) return <span className="text-muted-foreground">-</span>;
  if (port === FULL_PORT_RANGE) return <span className="text-muted-foreground">{t("rules.allPorts")}</span>;
  return <span className="font-mono tabular-nums">{port}</span>;
}

export function SourceChips({ sources, ctx }: { sources: string[]; ctx: SourceContext }) {
  const { t } = useTranslation();
  const norm = sources.map(normalizeCidr);
  const anyBoth = norm.includes(ANY_IPV4) && norm.includes(ANY_IPV6);
  const rest = anyBoth ? norm.filter((s) => s !== ANY_IPV4 && s !== ANY_IPV6) : norm;
  const home = ctx.homeIp ? `${ctx.homeIp}/32` : null;
  return (
    <span className="flex flex-wrap gap-1">
      {anyBoth && (
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
          <Globe className="size-3" />
          {t("rules.anywhere")}
        </span>
      )}
      {rest.map((s) => {
        const isHome = s === home;
        const note = ctx.notes?.get(s);
        return (
          <span
            key={s}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs",
              isHome ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-muted text-foreground/80",
            )}
            title={note}
          >
            {isHome && <House className="size-3" />}
            {s.endsWith("/32") ? s.slice(0, -3) : s}
            {note && <span className="font-sans text-muted-foreground">· {note}</span>}
          </span>
        );
      })}
    </span>
  );
}

export function ruleLabel(rule: FirewallRule): string {
  const d = rule.description ?? "";
  if (d.startsWith("hfl:")) {
    const i = d.indexOf(" ");
    return i >= 0 ? d.slice(i + 1) : d;
  }
  return d;
}

export function RuleRow({
  rule,
  ctx,
  change,
  showLabel = true,
  actions,
}: {
  rule: FirewallRule;
  ctx: SourceContext;
  change?: "added" | "removed";
  showLabel?: boolean;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "grid grid-cols-[1.25rem_3rem_6.5rem_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-sm",
        change === "added" && "bg-emerald-500/[0.07]",
        change === "removed" && "bg-red-500/[0.07] [&_.rule-body]:line-through [&_.rule-body]:decoration-red-500/40",
      )}
    >
      <span className="flex justify-center">
        {change === "added" && <Plus className="size-3.5 text-emerald-600" aria-label={t("preview.added")} />}
        {change === "removed" && <Minus className="size-3.5 text-red-600" aria-label={t("preview.removed")} />}
      </span>
      <span className="rule-body">
        <ProtocolBadge protocol={rule.direction === "out" ? `${rule.protocol}↑` : rule.protocol} />
      </span>
      <span className="rule-body text-sm">
        <PortLabel rule={rule} />
      </span>
      <span className="rule-body min-w-0 space-y-1">
        <SourceChips sources={rule.direction === "in" ? rule.source_ips : rule.destination_ips} ctx={ctx} />
        {showLabel && ruleLabel(rule) && <span className="block truncate text-xs text-muted-foreground">{ruleLabel(rule)}</span>}
      </span>
      <span className="flex items-center gap-1">{actions}</span>
    </div>
  );
}

export function RuleList({ rules, ctx, empty }: { rules: FirewallRule[]; ctx: SourceContext; empty?: string }) {
  if (rules.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="divide-y divide-border/60">
      {rules.map((r, i) => (
        <RuleRow key={i} rule={r} ctx={ctx} />
      ))}
    </div>
  );
}
