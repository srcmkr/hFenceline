import { z } from "zod";
import { parse } from "yaml";
import { ConfigSchema, tokenKey, validateConfig, type Config } from "./model/config";

export const BACKUP_FORMAT = "hfenceline-backup";

const PayloadSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  created: z.string(),
  app: z.string(),
  config: z.string(),
  tokens: z.record(z.string(), z.string()),
});
export type BackupPayload = z.infer<typeof PayloadSchema>;

export interface BackupSummary {
  created: string;
  app: string;
  customers: number;
  projects: number;
  tokens: number;
}

export class BackupError extends Error {
  constructor(
    readonly code: "invalid" | "config",
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export function projectTokenKeys(config: Config): string[] {
  return config.customers.flatMap((c) => c.projects.map((p) => tokenKey(c.id, p.id)));
}

export function readBackup(json: string): { payload: BackupPayload; config: Config; summary: BackupSummary } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BackupError("invalid", "kein hfenceline-backup");
  }
  const p = PayloadSchema.safeParse(data);
  if (!p.success) throw new BackupError("invalid", "kein hfenceline-backup");
  let raw: unknown;
  try {
    raw = parse(p.data.config);
  } catch (e) {
    throw new BackupError("config", String((e as Error).message));
  }
  const c = ConfigSchema.safeParse(raw);
  if (!c.success) throw new BackupError("config", c.error.message);
  const problems = validateConfig(c.data);
  if (problems.length) throw new BackupError("config", problems.join("\n"));
  const keys = projectTokenKeys(c.data);
  return {
    payload: p.data,
    config: c.data,
    summary: {
      created: p.data.created,
      app: p.data.app,
      customers: c.data.customers.length,
      projects: keys.length,
      tokens: keys.filter((k) => p.data.tokens[k]).length,
    },
  };
}
