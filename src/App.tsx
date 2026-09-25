import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileWarning, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ApplyResult } from "@/core/app/service";
import { setLanguage } from "@/i18n";
import { useService, useServiceState } from "@/ui/service-context";
import { NavContext, type View } from "@/ui/navigation";
import { Sidebar } from "@/ui/sidebar";
import { Topbar } from "@/ui/topbar";
import { Wizard } from "@/ui/wizard";
import { DashboardPage } from "@/ui/pages/dashboard";
import { ProjectPage } from "@/ui/pages/project";
import { FirewallPage } from "@/ui/pages/firewall";
import { TemplatesPage } from "@/ui/pages/templates";
import { LogPage } from "@/ui/pages/log";
import { SettingsPage } from "@/ui/pages/settings";
import { HomeIpDialog } from "@/ui/dialogs/home-ip-dialog";
import { setupTray } from "@/tray/tray";
import { isDesktop, onCloseToTray, quitApp, showWindow, startedHidden, trayAvailable } from "@/platform/desktop";
import { mode } from "@/platform";

export default function App() {
  const { t, i18n } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const [wizard, setWizard] = useState<null | 1 | 3>(null);
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [homeDialog, setHomeDialog] = useState<{ open: boolean; results: ApplyResult[] | null }>({ open: false, results: null });
  const [location, setLocation] = useState("");
  const [secretsBackend, setSecretsBackend] = useState("");
  const hasTray = useRef(false);

  useEffect(() => {
    if (state.phase === "first-run" || (state.phase === "ready" && state.config?.customers.length === 0)) setWizard(1);
  }, [state.phase]);

  useEffect(() => {
    if (state.config) setLanguage(state.config.language);
  }, [state.config?.language]);

  useEffect(() => {
    void service.storageInfo().then(({ location, secrets }) => {
      setLocation(location);
      setSecretsBackend(secrets);
    });
  }, [service]);

  const loaded = state.phase !== "loading";
  useEffect(() => {
    if (!isDesktop || !loaded) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      hasTray.current = await trayAvailable();
      await onCloseToTray(() => hasTray.current);
      if (!hasTray.current && (await startedHidden())) await showWindow();
      if (!hasTray.current || cancelled) return;
      cleanup = await setupTray(service, i18n, {
        openWindow: () => void showWindow(),
        quit: () => void quitApp(),
        applyHomeIp: async () => {
          const results = await service.applyHomeIp().catch(() => null);
          if (!results || results.some((r) => !r.ok)) {
            await showWindow();
            setHomeDialog({ open: true, results });
          }
        },
      });
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [loaded, service, i18n]);

  if (state.phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.phase === "config-error") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl space-y-4 rounded-2xl border bg-card p-8 shadow-sm">
          <FileWarning className="size-8 text-destructive" />
          <h1 className="text-xl font-semibold">{t("configError.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("configError.text", { location })}</p>
          <ul className="list-disc space-y-1 rounded-lg bg-muted/50 py-3 pr-3 pl-8 font-mono text-xs">
            {state.configProblems?.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <Button onClick={() => void service.start()}>
            <RotateCcw className="size-4" />
            {t("configError.reload")}
          </Button>
        </div>
      </div>
    );
  }

  const banner =
    mode !== "desktop" ? (
      <div className="border-b bg-amber-400/15 px-6 py-1.5 text-xs text-amber-800 dark:text-amber-300">
        {t(mode === "demo" ? "app.demoBanner" : "app.browserBanner")}
      </div>
    ) : null;

  if (wizard || !state.overview) {
    return (
      <div className="flex h-full flex-col">
        {banner}
        <div className="min-h-0 flex-1">
      <Wizard
        startStep={wizard ?? 1}
        onCancel={wizard === 3 ? () => setWizard(null) : undefined}
        onFinish={() => {
          setWizard(null);
          setView({ kind: "dashboard" });
          void service.refreshAll();
        }}
      />
        </div>
      </div>
    );
  }

  const overview = state.overview;
  const fw = view.kind === "firewall" ? overview.firewalls.find((f) => f.key === view.key) : undefined;
  const project = view.kind === "project" ? overview.projects.find((p) => p.key === view.key) : undefined;
  const title =
    view.kind === "firewall"
      ? t("nav.firewall")
      : view.kind === "project"
        ? t("nav.project")
        : t(`nav.${view.kind}`);

  let page: React.ReactNode;
  if (fw) page = <FirewallPage key={fw.key} view={fw} />;
  else if (project) page = <ProjectPage key={project.key} view={project} />;
  else if (view.kind === "templates") page = <TemplatesPage templateId={view.templateId} />;
  else if (view.kind === "log") page = <LogPage />;
  else if (view.kind === "settings") page = <SettingsPage location={location} secretsBackend={secretsBackend} />;
  else
    page = (
      <DashboardPage onApplyHomeIp={() => setHomeDialog({ open: true, results: null })} onAddProject={() => setWizard(3)} />
    );

  return (
    <NavContext.Provider value={{ view, go: setView }}>
      <div className="flex h-full">
        <Sidebar overview={overview} onAddProject={() => setWizard(3)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar title={title} onApplyHomeIp={() => setHomeDialog({ open: true, results: null })} />
          {banner}
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-7xl px-6 py-6">{page}</div>
          </ScrollArea>
        </div>
      </div>
      <HomeIpDialog
        open={homeDialog.open}
        initialResults={homeDialog.results}
        onOpenChange={(open) => setHomeDialog((d) => ({ ...d, open }))}
      />
    </NavContext.Provider>
  );
}
