import type { FetchFn } from "../hetzner/client";
import { isValidIPv4 } from "../net/ip";

export const IPIFY_URL = "https://api.ipify.org/";

export class HomeIpError extends Error {
  constructor(
    readonly code: "network" | "http" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "HomeIpError";
  }
}

export async function fetchHomeIp(fetch: FetchFn, url = IPIFY_URL, timeoutMs = 10_000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "text/plain" } });
  } catch (e) {
    throw new HomeIpError("network", `IP-Dienst nicht erreichbar: ${String((e as Error)?.message ?? e)}`);
  }
  if (!res.ok) throw new HomeIpError("http", `IP-Dienst antwortet mit HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!isValidIPv4(text)) throw new HomeIpError("invalid", `IP-Dienst liefert keine gültige IPv4: "${text.slice(0, 60)}"`);
  return text;
}
