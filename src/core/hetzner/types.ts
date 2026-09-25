import { z } from "zod";

export const HetznerProtocolSchema = z.enum(["tcp", "udp", "icmp", "esp", "gre"]);
export type HetznerProtocol = z.infer<typeof HetznerProtocolSchema>;

export const FirewallRuleSchema = z.object({
  direction: z.enum(["in", "out"]),
  protocol: HetznerProtocolSchema,
  port: z.string().nullish(),
  source_ips: z.array(z.string()).default([]),
  destination_ips: z.array(z.string()).default([]),
  description: z.string().nullish(),
});
export type FirewallRule = z.infer<typeof FirewallRuleSchema>;

const ResourceRefSchema = z.object({
  type: z.string(),
  server: z.object({ id: z.number() }).nullish(),
});

export const AppliedToSchema = z.object({
  type: z.string(),
  server: z.object({ id: z.number() }).nullish(),
  label_selector: z.object({ selector: z.string() }).nullish(),
  applied_to_resources: z.array(ResourceRefSchema).nullish(),
});
export type AppliedTo = z.infer<typeof AppliedToSchema>;

export const FirewallSchema = z.object({
  id: z.number(),
  name: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
  created: z.string().optional(),
  rules: z.array(FirewallRuleSchema).default([]),
  applied_to: z.array(AppliedToSchema).default([]),
});
export type Firewall = z.infer<typeof FirewallSchema>;

export const ServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
  public_net: z
    .object({
      ipv4: z.object({ ip: z.string() }).nullish(),
      firewalls: z
        .array(z.object({ id: z.number(), status: z.string() }))
        .default([]),
    })
    .default({ firewalls: [] }),
});
export type Server = z.infer<typeof ServerSchema>;

export const ActionSchema = z.object({
  id: z.number(),
  command: z.string(),
  status: z.enum(["running", "success", "error"]),
  progress: z.number().optional(),
  error: z.object({ code: z.string(), message: z.string() }).nullish(),
});
export type Action = z.infer<typeof ActionSchema>;

export const PaginationSchema = z.object({
  page: z.number(),
  per_page: z.number(),
  previous_page: z.number().nullish(),
  next_page: z.number().nullish(),
  last_page: z.number().nullish(),
  total_entries: z.number().nullish(),
});

export const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const MANAGED_LABEL_KEY = "managed-by";
export const MANAGED_LABEL_VALUE = "hfenceline";

export const MAX_EFFECTIVE_RULES = 500;
