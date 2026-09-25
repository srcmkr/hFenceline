import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FirewallState } from "@/core/app/overview";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const STATE_STYLE: Record<FirewallState, { dot: string; badge: string }> = {
  ok: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25",
  },
  drifted: {
    dot: "bg-amber-400",
    badge: "bg-amber-400/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  },
  "home-ip": {
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/25",
  },
  foreign: {
    dot: "bg-white ring-1 ring-inset ring-slate-400 dark:bg-slate-200",
    badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/25",
  },
  unreachable: {
    dot: "bg-zinc-800 dark:bg-zinc-400",
    badge: "bg-zinc-800/10 text-zinc-800 dark:text-zinc-300 ring-zinc-500/30",
  },
  unknown: {
    dot: "bg-muted-foreground/30",
    badge: "bg-muted text-muted-foreground ring-border",
  },
};

export function StatusDot({ state, className, pulse }: { state: FirewallState; className?: string; pulse?: boolean }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={t(`state.${state}`)}
          className={cn("relative inline-flex size-2.5 shrink-0 rounded-full", STATE_STYLE[state].dot, className)}
        >
          {pulse && (state === "home-ip" || state === "unreachable") && (
            <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", STATE_STYLE[state].dot)} />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{t(`state.${state}`)}</TooltipContent>
    </Tooltip>
  );
}

export function StatusBadge({ state, className }: { state: FirewallState; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        STATE_STYLE[state].badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STATE_STYLE[state].dot)} />
      {t(`state.${state}`)}
    </span>
  );
}
