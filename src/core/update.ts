import { z } from "zod";
import type { FetchFn } from "./hetzner/client";

const ReleaseSchema = z.object({ tag_name: z.string(), html_url: z.string() });

export interface Release {
  version: string;
  url: string;
}

function parts(v: string): number[] {
  return v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function fetchLatestRelease(fetch: FetchFn, repo: string): Promise<Release | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const r = ReleaseSchema.safeParse(await res.json());
    return r.success ? { version: r.data.tag_name.replace(/^v/i, ""), url: r.data.html_url } : null;
  } catch {
    return null;
  }
}
