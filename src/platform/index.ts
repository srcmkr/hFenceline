import { AppService } from "@/core/app/service";
import { isDesktop } from "./desktop";
import { tauriPorts } from "./tauri";
import { BROWSER_API_BASE, BROWSER_IP_URL, browserPorts } from "./browser";
import { demoPorts } from "./demo";

export type Mode = "desktop" | "browser" | "demo";

export const mode: Mode = isDesktop
  ? "desktop"
  : new URLSearchParams(location.search).has("demo")
    ? "demo"
    : "browser";

export function createService(): AppService {
  switch (mode) {
    case "desktop":
      return new AppService(tauriPorts());
    case "demo":
      return new AppService(demoPorts(new URLSearchParams(location.search).get("demo") === "empty"));
    case "browser":
      return new AppService(browserPorts(), { apiBaseUrl: BROWSER_API_BASE, ipUrl: BROWSER_IP_URL });
  }
}
