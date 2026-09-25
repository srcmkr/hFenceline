import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import de from "./de.json";
import en from "./en.json";
import { STATE_ORDER } from "../core/app/overview";

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "components" || f === "core" ? [] : sources(p);
    return /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const deKeys = new Set(flatten(de));
const enKeys = new Set(flatten(en));
const has = (k: string) => deKeys.has(k) || (deKeys.has(`${k}_one`) && deKeys.has(`${k}_other`));

describe("Übersetzungen", () => {
  it("de/en gleich", () => {
    expect([...deKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !deKeys.has(k))).toEqual([]);
  });

  it("keys existieren", () => {
    const missing: string[] = [];
    for (const file of sources("src")) {
      const text = readFileSync(file, "utf8");
      for (const call of text.matchAll(/\btr?\(([^()]*)\)/g)) {
        for (const lit of call[1]!.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+)"/g)) {
          if (!has(lit[1]!)) missing.push(`${file}: ${lit[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("dynamische keys", () => {
    const dynamic = [
      ...STATE_ORDER.map((s) => `state.${s}`),
      ...["lockout", "rule-limit", "no-home-ip", "no-rules"].flatMap((w) => [`warnings.${w}.title`, `warnings.${w}.text`]),
      ...["set_rules", "create", "labels"].map((a) => `log.action.${a}`),
      ...["home-ip", "apply", "import", "create"].map((a) => `log.trigger.${a}`),
      ...[1, 2, 3, 4, 5].flatMap((s) => [`wizard.step${s}.short`, `wizard.step${s}.title`, `wizard.step${s}.text`]),
      ...["green", "yellow", "red"].map((c) => `tray.tooltip.${c}`),
      ...["dashboard", "templates", "log", "settings"].map((v) => `nav.${v}`),
      ...["keep", "adopt", "drop"].map((o) => `foreign.${o}`),
      ...["network", "http", "invalid"].map((c) => `errors.homeip.${c}`),
      ...["no-keyring", "failed"].map((c) => `errors.secrets.${c}`),
      ...["keyring", "file", "memory", "unknown"].map((c) => `settings.tokenBackend.${c}`),
      ...["unauthorized", "forbidden", "not_found", "network", "timeout", "rate_limit_exceeded", "invalid_response", "action_failed", "other"].map(
        (c) => `errors.hetzner.${c}`,
      ),
    ];
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });
});
