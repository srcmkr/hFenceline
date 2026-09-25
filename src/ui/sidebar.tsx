import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bug, ChevronRight, Scale, FileClock, FolderPlus, LayoutDashboard, Layers, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Overview } from "@/core/app/overview";
import { StatusDot } from "./status";
import { useNav, type View } from "./navigation";
import { Logo } from "./logo";
import { openUrl } from "@/platform/desktop";
import { APP_VERSION, ISSUES_URL, REPO, REPO_URL } from "@/platform/links";
import { isNewer, type Release } from "@/core/update";
import { useService } from "./service-context";
import { LicensesDialog } from "./dialogs/licenses-dialog";

function NavItem({ view, icon: Icon, label }: { view: View; icon: typeof Settings; label: string }) {
  const nav = useNav();
  const active = nav.view.kind === view.kind;
  return (
    <button
      onClick={() => nav.go(view)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
      )}
    >
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </button>
  );
}

export function Sidebar({ overview, onAddProject }: { overview: Overview; onAddProject: () => void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [licensesOpen, setLicensesOpen] = useState(false);

  const customers = new Map<string, { name: string; projects: Overview["projects"] }>();
  for (const p of overview.projects) {
    const c = customers.get(p.customer.id) ?? { name: p.customer.name, projects: [] };
    c.projects.push(p);
    customers.set(p.customer.id, c);
  }

  const selected = (kind: string, key: string) =>
    (nav.view.kind === "project" || nav.view.kind === "firewall") && nav.view.kind === kind && nav.view.key === key;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <Logo className="size-7" color={overview.trayColor} />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">hFenceline</div>
          <div className="text-[11px] text-muted-foreground">{t("app.tagline")}</div>
        </div>
      </div>

      <nav className="space-y-0.5 p-2">
        <NavItem view={{ kind: "dashboard" }} icon={LayoutDashboard} label={t("nav.dashboard")} />
        <NavItem view={{ kind: "templates" }} icon={Layers} label={t("nav.templates")} />
        <NavItem view={{ kind: "log" }} icon={FileClock} label={t("nav.log")} />
        <NavItem view={{ kind: "settings" }} icon={Settings} label={t("nav.settings")} />
      </nav>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("nav.projects")}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-2 pb-3">
          {customers.size === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("nav.noProjects")}</p>}
          {[...customers.entries()].map(([cid, c]) => (
            <div key={cid}>
              <div className="truncate px-2.5 py-1 text-xs font-medium text-muted-foreground">{c.name}</div>
              {c.projects.map((p) => {
                const isCollapsed = collapsed[p.key];
                return (
                  <div key={p.key}>
                    <div
                      className={cn(
                        "group flex items-center rounded-md transition-colors",
                        selected("project", p.key) ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
                      )}
                    >
                      <button
                        className="flex size-7 items-center justify-center text-muted-foreground"
                        onClick={() => setCollapsed({ ...collapsed, [p.key]: !isCollapsed })}
                        aria-label={isCollapsed ? t("nav.expand") : t("nav.collapse")}
                      >
                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                      </button>
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left text-sm font-medium"
                        onClick={() => nav.go({ kind: "project", key: p.key })}
                      >
                        <span className="truncate">{p.project.name}</span>
                        <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
                          {p.data?.loading ? (
                            <span className="size-2.5 animate-pulse rounded-full bg-muted-foreground/30" />
                          ) : (
                            <StatusDot state={p.state} pulse />
                          )}
                        </span>
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="ml-[13px] border-l pl-2">
                        {p.firewalls.map((f) => (
                          <button
                            key={f.key}
                            onClick={() => nav.go({ kind: "firewall", key: f.key })}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[13px] transition-colors",
                              selected("firewall", f.key)
                                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                            )}
                          >
                            <span className="truncate">{f.name}</span>
                            <span className="ml-auto">
                              <StatusDot state={f.state} />
                            </span>
                          </button>
                        ))}
                        {p.firewalls.length === 0 && (
                          <div className="px-2.5 py-1 text-xs text-muted-foreground">{t("nav.noFirewalls")}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start gap-2.5 text-sm" onClick={onAddProject}>
          <FolderPlus className="size-4" />
          {t("nav.addProject")}
        </Button>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 px-2.5 pb-1 text-xs text-muted-foreground">
          <FooterLink href={REPO_URL} title={REPO_URL}>
            <GitHubMark className="size-3.5" />
            {t("nav.github")}
          </FooterLink>
          <button
            type="button"
            title={t("licenses.title")}
            onClick={() => setLicensesOpen(true)}
            className="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground"
          >
            <Scale className="size-3.5" />
            MIT
          </button>
          <VersionInfo />
          <FooterLink href={ISSUES_URL} title={ISSUES_URL}>
            <Bug className="size-3.5" />
            {t("nav.reportIssue")}
          </FooterLink>
        </div>
      </div>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </aside>
  );
}

function FooterLink({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => void openUrl(href)}
      className="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function VersionInfo() {
  const { t } = useTranslation();
  const service = useService();
  const [release, setRelease] = useState<Release | null | undefined>(undefined);

  useEffect(() => {
    const check = () => void service.latestRelease(REPO).then(setRelease);
    check();
    const id = setInterval(check, 6 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [service]);

  const update = release && isNewer(release.version, APP_VERSION) ? release : null;
  const title = update ? t("update.available", { version: update.version }) : release ? t("update.latest") : t("update.unknown");
  return (
    <button
      type="button"
      title={title}
      disabled={!update}
      onClick={() => update && void openUrl(update.url)}
      className={cn("flex items-center gap-1 whitespace-nowrap tabular-nums", update && "text-foreground hover:underline")}
    >
      <span className="flex size-3.5 items-center justify-center">
        <span
          className={cn(
            "size-1.5 rounded-full",
            update ? "bg-red-500" : release ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      </span>
      v{APP_VERSION}
    </button>
  );
}
