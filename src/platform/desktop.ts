import { invoke, isTauri } from "@tauri-apps/api/core";

export const isDesktop = isTauri();

export async function openUrl(url: string): Promise<void> {
  if (isDesktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export const autostart = {
  async isEnabled(): Promise<boolean> {
    if (!isDesktop) return false;
    const m = await import("@tauri-apps/plugin-autostart");
    return m.isEnabled();
  },
  async set(enabled: boolean): Promise<void> {
    if (!isDesktop) return;
    const m = await import("@tauri-apps/plugin-autostart");
    if (enabled) await m.enable();
    else await m.disable();
  },
};

export async function showWindow(): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.show();
  await w.unminimize();
  await w.setFocus();
}

export async function hideWindow(): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function quitApp(): Promise<void> {
  if (!isDesktop) return;
  await invoke("quit");
}

export async function trayAvailable(): Promise<boolean> {
  if (!isDesktop) return false;
  return invoke<boolean>("tray_available");
}

export async function startedHidden(): Promise<boolean> {
  if (!isDesktop) return false;
  return invoke<boolean>("started_hidden");
}

export async function onCloseToTray(hasTray: () => boolean): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.onCloseRequested(async (event) => {
    if (hasTray()) {
      event.preventDefault();
      await w.hide();
    }
  });
}

export function consoleUrl(consoleProjectId?: number, serverId?: number): string {
  if (!consoleProjectId) return "https://console.hetzner.com/projects";
  const base = `https://console.hetzner.com/projects/${consoleProjectId}`;
  return serverId ? `${base}/servers/${serverId}/firewalls` : `${base}/firewalls`;
}

const BACKUP_FILTER = [{ name: "hFenceline Backup", extensions: ["age"] }];

export async function pickBackupSavePath(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters: BACKUP_FILTER });
}

export async function pickBackupOpenPath(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory: false, filters: BACKUP_FILTER });
  return typeof r === "string" ? r : null;
}

export function writeBackupFile(path: string, passphrase: string, payload: string): Promise<void> {
  return invoke("backup_export", { path, passphrase, payload });
}

export function readBackupFile(path: string, passphrase: string): Promise<string> {
  return invoke<string>("backup_import", { path, passphrase });
}
