import type { i18n as I18n } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import type { AppService } from "@/core/app/service";
import type { TrayColor } from "@/core/app/overview";

export interface TrayHandlers {
  openWindow: () => void;
  applyHomeIp: () => Promise<void>;
  quit: () => void;
}

interface TrayState {
  color: TrayColor;
  tooltip: string;
  openText: string;
  applyText: string;
  applyEnabled: boolean;
  checkText: string;
  quitText: string;
}

let started: Promise<() => void> | null = null;

export function setupTray(service: AppService, i18n: I18n, handlers: TrayHandlers): Promise<() => void> {
  started ??= invoke<string>("tray_backend").then((b) =>
    b === "ksni" ? createKsni(service, i18n, handlers) : createTauri(service, i18n, handlers),
  );
  return started;
}

function trayState(service: AppService, i18n: I18n): TrayState {
  const s = service.getState();
  const o = s.overview;
  const t = i18n.t.bind(i18n);
  const color: TrayColor = o?.trayColor ?? "green";
  const targets = o?.homeIpTargets.length ?? 0;
  return {
    color,
    tooltip: t(`tray.tooltip.${color}`),
    openText: t("tray.open"),
    applyText: s.homeIp ? t("tray.applyHomeIp", { ip: s.homeIp, count: targets }) : t("tray.applyHomeIpUnknown"),
    applyEnabled: !!s.homeIp && targets > 0,
    checkText: t("tray.check"),
    quitText: t("tray.quit"),
  };
}

function watch(service: AppService, i18n: I18n, update: () => void) {
  update();
  const unsubscribe = service.subscribe(update);
  i18n.on("languageChanged", update);
  return () => {
    unsubscribe();
    i18n.off("languageChanged", update);
  };
}

function check(service: AppService) {
  void service.refreshHomeIp();
  void service.refreshAll();
}

// linux: das tray lebt in rust (src-tauri/src/linux_tray.rs), hier nur zustand und menü-events
async function createKsni(service: AppService, i18n: I18n, handlers: TrayHandlers): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<string>("tray-action", (e) => {
    if (e.payload === "apply-home-ip") void handlers.applyHomeIp();
    if (e.payload === "check") check(service);
  });
  let last = "";
  const stop = watch(service, i18n, () => {
    const state = trayState(service, i18n);
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    void invoke("tray_update", { tray: state });
  });
  return () => {
    stop();
    unlisten();
    started = null;
  };
}

async function iconBytes(color: TrayColor): Promise<Uint8Array> {
  const res = await fetch(`/tray/${color}.png`);
  return new Uint8Array(await res.arrayBuffer());
}

async function createTauri(service: AppService, i18n: I18n, handlers: TrayHandlers): Promise<() => void> {
  const { TrayIcon } = await import("@tauri-apps/api/tray");
  const { Menu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");

  const icons: Record<TrayColor, Uint8Array> = {
    green: await iconBytes("green"),
    yellow: await iconBytes("yellow"),
    red: await iconBytes("red"),
  };

  const open = await MenuItem.new({ id: "open", text: "", action: handlers.openWindow });
  const apply = await MenuItem.new({ id: "apply-home-ip", text: "", action: () => void handlers.applyHomeIp() });
  const checkItem = await MenuItem.new({ id: "check", text: "", action: () => check(service) });
  const quit = await MenuItem.new({
    id: "quit",
    text: "",
    action: async () => {
      await tray.close().catch(() => {});
      handlers.quit();
    },
  });
  const separator = () => PredefinedMenuItem.new({ item: "Separator" });
  const menu = await Menu.new({ items: [open, await separator(), apply, checkItem, await separator(), quit] });

  const tray = await TrayIcon.new({
    id: "hfenceline",
    icon: icons.green,
    menu,
    menuOnLeftClick: false,
    tooltip: "hFenceline",
    action: (e) => {
      if (e.type === "DoubleClick" || (e.type === "Click" && e.button === "Left" && e.buttonState === "Up")) handlers.openWindow();
    },
  });

  let last = "";
  const stop = watch(service, i18n, () => {
    const s = trayState(service, i18n);
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    void (async () => {
      await tray.setIcon(icons[s.color]);
      await tray.setTooltip(`hFenceline: ${s.tooltip}`);
      await open.setText(s.openText);
      await apply.setText(s.applyText);
      await apply.setEnabled(s.applyEnabled);
      await checkItem.setText(s.checkText);
      await quit.setText(s.quitText);
    })();
  });
  return () => {
    stop();
    void tray.close();
    started = null;
  };
}
