import { useTranslation } from "react-i18next";
import { ArrowRight, FolderPlus, House, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FirewallState, Overview } from "@/core/app/overview";
import { useServiceState } from "../service-context";
import { StatusBadge, StatusDot, STATE_STYLE } from "../status";
import { useNav } from "../navigation";
import { Logo } from "../logo";
import { errorText } from "../errors";

export function DashboardPage({ onApplyHomeIp, onAddProject }: { onApplyHomeIp: () => void; onAddProject: () => void }) {
  const { t } = useTranslation();
  const state = useServiceState();
  const nav = useNav();
  const o = state.overview!;

  const count = (s: FirewallState) => o.firewalls.filter((f) => f.states.includes(s)).length;
  const unprotected = o.projects.reduce((n, p) => n + p.unprotected.length, 0);
  const attention = o.firewalls.filter((f) => f.state !== "ok" && f.state !== "foreign" && f.state !== "unknown");
  const projectIssues = o.projects.filter((p) => p.data?.error || p.unprotected.length > 0 || p.onlyUnmanaged.length > 0);
  const homeTargets = o.homeIpTargets.length;
  const needsHome = (o.homeIpChanged && homeTargets > 0) || count("home-ip") > 0;

  const headline =
    o.projects.length === 0
      ? t("dashboard.empty")
      : needsHome
        ? t("dashboard.homeChanged", { count: count("home-ip") || homeTargets })
        : o.hasErrors
          ? t("dashboard.errors")
          : o.trayColor === "yellow"
            ? t("dashboard.attention")
            : t("dashboard.allGood");

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-6",
          o.trayColor === "green" && "bg-gradient-to-br from-emerald-500/[0.08] to-transparent",
          o.trayColor === "yellow" && "bg-gradient-to-br from-amber-400/[0.12] to-transparent",
          o.trayColor === "red" && "bg-gradient-to-br from-red-500/[0.10] to-transparent",
        )}
      >
        <div className="flex flex-wrap items-center gap-5">
          <Logo className="size-14 drop-shadow-sm" color={o.trayColor} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("dashboard.summary", { firewalls: o.firewalls.length, projects: o.projects.length })}
            </p>
          </div>
          {needsHome && (
            <Button size="lg" variant="destructive" onClick={onApplyHomeIp} disabled={!state.homeIp}>
              <House className="size-4" />
              {t("homeip.applyLong", { ip: state.homeIp, count: homeTargets })}
            </Button>
          )}
          {o.projects.length === 0 && (
            <Button size="lg" onClick={onAddProject}>
              <FolderPlus className="size-4" />
              {t("nav.addProject")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("dashboard.stat.managed")} value={o.firewalls.length} />
        <Stat label={t("state.ok")} value={count("ok")} state="ok" />
        <Stat label={t("state.drifted")} value={count("drifted")} state="drifted" />
        <Stat label={t("state.home-ip")} value={count("home-ip")} state="home-ip" />
        <Stat label={t("state.unreachable")} value={count("unreachable")} state="unreachable" />
        <Stat label={t("dashboard.stat.unprotected")} value={unprotected} warn={unprotected > 0} icon={<ShieldOff className="size-3.5" />} />
      </div>

      {(attention.length > 0 || projectIssues.length > 0) && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="border-b px-4 py-3 text-sm font-semibold">{t("dashboard.todo")}</header>
          <div className="divide-y">
            {projectIssues.map((p) => (
              <button
                key={p.key}
                onClick={() => nav.go({ kind: "project", key: p.key })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <StatusDot state={p.data?.error ? "unreachable" : "drifted"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {p.customer.name} · {p.project.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{projectIssueText(t, p)}</div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            ))}
            {attention.map((f) => {
              const p = o.projects.find((x) => x.key === f.key.split("/").slice(0, 2).join("/"))!;
              return (
                <button
                  key={f.key}
                  onClick={() => nav.go({ kind: "firewall", key: f.key })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <StatusDot state={f.state} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.customer.name} · {p.project.name}
                    </div>
                  </div>
                  <StatusBadge state={f.state} />
                  <ArrowRight className="size-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function projectIssueText(t: ReturnType<typeof useTranslation>["t"], p: Overview["projects"][number]): string {
  if (p.data?.error) return errorText(t, p.data.error).title;
  const parts: string[] = [];
  if (p.unprotected.length) parts.push(t("servers.unprotectedTitle", { count: p.unprotected.length }));
  if (p.onlyUnmanaged.length) parts.push(t("servers.onlyUnmanagedTitle", { count: p.onlyUnmanaged.length }));
  return parts.join(" · ");
}

function Stat({ label, value, state, warn, icon }: { label: string; value: number; state?: FirewallState; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {state && <span className={cn("size-2 rounded-full", STATE_STYLE[state].dot)} />}
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", warn && "text-amber-600 dark:text-amber-400", value === 0 && "text-muted-foreground/60")}>
        {value}
      </div>
    </div>
  );
}
