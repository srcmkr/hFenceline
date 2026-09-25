import { useTranslation } from "react-i18next";
import { House, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useService, useServiceState } from "./service-context";

export function Topbar({ title, onApplyHomeIp }: { title: React.ReactNode; onApplyHomeIp: () => void }) {
  const { t, i18n } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const overview = state.overview!;
  const loading = Object.values(state.data).some((d) => d.loading) || state.homeIpLoading;
  const changed = overview.homeIpChanged && overview.homeIpTargets.length > 0;
  const outdated = overview.firewalls.filter((f) => f.states.includes("home-ip")).length;
  const needsApply = changed || outdated > 0;
  const checked = state.homeIpCheckedAt
    ? new Date(state.homeIpCheckedAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-6 backdrop-blur">
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</div>

      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border py-1 pr-1 pl-3 text-sm",
          needsApply && "border-red-500/40 bg-red-500/[0.06]",
        )}
      >
        {state.homeIpError ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlert className="size-4 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{state.homeIpError}</TooltipContent>
          </Tooltip>
        ) : (
          <House className={cn("size-4", needsApply ? "text-red-500" : "text-muted-foreground")} />
        )}
        <div className="leading-tight">
          <div className="font-mono text-[13px] font-medium">{state.homeIp ?? "-"}</div>
          <div className="text-[10.5px] text-muted-foreground">
            {state.homeIpError ? t("homeip.checkFailed") : checked ? t("homeip.checkedAt", { time: checked }) : t("homeip.label")}
          </div>
        </div>
        {needsApply ? (
          <Button size="sm" variant="destructive" className="ml-1" onClick={onApplyHomeIp} disabled={!state.homeIp}>
            {t("homeip.applyShort", { count: overview.homeIpTargets.length })}
          </Button>
        ) : (
          <span className="w-1" />
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("actions.checkStatus")}
            onClick={() => {
              void service.refreshHomeIp();
              void service.refreshAll();
            }}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("actions.checkStatus")}</TooltipContent>
      </Tooltip>
    </header>
  );
}
