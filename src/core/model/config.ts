import { z } from "zod";

export const PROTOCOLS = ["tcp", "udp", "icmp", "esp", "gre", "all"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const SOURCE_ANY = "any";
export const SOURCE_HOME = "{heim}";
export const SOURCE_STATIC = "{fest}";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "nur Kleinbuchstaben, Ziffern und Bindestrich");

const port = z.string().regex(/^\d{1,5}(-\d{1,5})?$/, "Port oder Bereich wie 1024-5000");

export const RuleSpecSchema = z.object({
  protocol: z.enum(PROTOCOLS),
  port: port.optional(),
  from: z.array(z.string()).min(1),
});
export type RuleSpec = z.infer<typeof RuleSpecSchema>;

export const BlockSchema = z.object({
  id,
  name: z.string().min(1),
  optional: z.boolean().optional(),
  default: z.boolean().optional(),
  rules: z.array(RuleSpecSchema),
});
export type Block = z.infer<typeof BlockSchema>;

export const TemplateSchema = z.object({
  id,
  name: z.string().min(1),
  blocks: z.array(BlockSchema),
});
export type Template = z.infer<typeof TemplateSchema>;

export const StaticIpSchema = z.object({
  cidr: z.string().min(1),
  note: z.string().optional(),
});
export type StaticIp = z.infer<typeof StaticIpSchema>;

export const ExtraRuleSchema = z.object({
  name: z.string().min(1),
  protocol: z.enum(PROTOCOLS),
  port: port.optional(),
  from: z.array(z.string()).min(1),
});
export type ExtraRule = z.infer<typeof ExtraRuleSchema>;

export const ManagedFirewallSchema = z.object({
  hetzner_id: z.number().int().positive(),
  template: id,
  blocks: z.record(z.string(), z.boolean()).optional(),
  static_ips: z.array(StaticIpSchema).optional(),
  extra_rules: z.array(ExtraRuleSchema).optional(),
});
export type ManagedFirewall = z.infer<typeof ManagedFirewallSchema>;

export const ProjectSchema = z.object({
  id,
  name: z.string().min(1),
  console_project_id: z.number().int().positive().optional(),
  firewalls: z.array(ManagedFirewallSchema).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CustomerSchema = z.object({
  id,
  name: z.string().min(1),
  projects: z.array(ProjectSchema).default([]),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const LANGUAGES = ["de", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const ConfigSchema = z.object({
  version: z.literal(1),
  language: z.enum(LANGUAGES),
  homeip: z
    .object({
      last_applied: z.string().optional(),
      check_interval_minutes: z.number().int().min(1).max(1440).optional(),
    })
    .default({}),
  autostart: z.boolean().optional(),
  templates: z.array(TemplateSchema).default([]),
  customers: z.array(CustomerSchema).default([]),
});
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CHECK_INTERVAL_MINUTES = 5;

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  const dup = (what: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const i of ids) {
      if (seen.has(i)) errors.push(`${what} "${i}" ist doppelt`);
      seen.add(i);
    }
  };
  dup("Vorlage", config.templates.map((t) => t.id));
  for (const t of config.templates) dup(`Baustein in Vorlage ${t.id}`, t.blocks.map((b) => b.id));
  dup("Kunde", config.customers.map((c) => c.id));
  const templateIds = new Set(config.templates.map((t) => t.id));
  for (const c of config.customers) {
    dup(`Projekt bei Kunde ${c.id}`, c.projects.map((p) => p.id));
    for (const p of c.projects) {
      dup(`Firewall in Projekt ${c.id}/${p.id}`, p.firewalls.map((f) => String(f.hetzner_id)));
      for (const f of p.firewalls) {
        if (!templateIds.has(f.template)) {
          errors.push(`Firewall ${f.hetzner_id} in ${c.id}/${p.id} verweist auf unbekannte Vorlage "${f.template}"`);
        }
      }
    }
  }
  return errors;
}

export function findTemplate(config: Config, templateId: string): Template | undefined {
  return config.templates.find((t) => t.id === templateId);
}

export function tokenKey(customerId: string, projectId: string): string {
  return `hfenceline/${customerId}/${projectId}`;
}

export function slugify(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
