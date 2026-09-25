import type { FirewallRule } from "../hetzner/types";
import type { FileStore } from "../ports";

export const AUDIT_FILE = "audit.jsonl";

export type AuditAction = "set_rules" | "create" | "labels";
export type AuditTrigger = "home-ip" | "apply" | "import" | "create";

export interface AuditEntry {
  time: string;
  action: AuditAction;
  trigger: AuditTrigger;
  customer: string;
  project: string;
  firewall_id: number | null;
  firewall_name: string;
  old_rules?: FirewallRule[];
  new_rules?: FirewallRule[];
  old_labels?: Record<string, string>;
  new_labels?: Record<string, string>;
  result: "ok" | "error";
  error?: string;
}

export class AuditLog {
  constructor(
    private readonly files: FileStore,
    private readonly name = AUDIT_FILE,
  ) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.files.append(this.name, `${JSON.stringify(entry)}\n`);
  }

  async readAll(): Promise<AuditEntry[]> {
    const text = (await this.files.read(this.name)) ?? "";
    const out: AuditEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as AuditEntry;
        if (e && typeof e.time === "string" && typeof e.action === "string") out.push(e);
      } catch {
      }
    }
    return out.reverse();
  }
}
