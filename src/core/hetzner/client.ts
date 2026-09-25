import { z } from "zod";
import {
  ActionSchema,
  ErrorBodySchema,
  FirewallSchema,
  PaginationSchema,
  ServerSchema,
  type Action,
  type Firewall,
  type FirewallRule,
  type Server,
} from "./types";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  token: string;
  fetch: FetchFn;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  actionPollMs?: number;
  actionTimeoutMs?: number;
  maxRateLimitWaitMs?: number;
  requestTimeoutMs?: number;
}

export const HETZNER_API = "https://api.hetzner.cloud/v1";
const PER_PAGE = 50;

export class HetznerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "HetznerError";
  }
}

export function isUnreachable(e: unknown): boolean {
  return (
    e instanceof HetznerError &&
    ["unauthorized", "forbidden", "not_found", "network", "timeout"].includes(e.code)
  );
}

export interface TokenCheck {
  valid: boolean;
  writable: boolean;
  error?: HetznerError;
}

export class HetznerClient {
  private readonly base: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private rateLimitRemaining: number | null = null;
  private rateLimitReset: number | null = null;

  constructor(private readonly opts: ClientOptions) {
    this.base = opts.baseUrl ?? HETZNER_API;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  async listFirewalls(): Promise<Firewall[]> {
    return this.listAll("/firewalls", "firewalls", FirewallSchema);
  }

  async getFirewall(id: number): Promise<Firewall> {
    const body = await this.request("GET", `/firewalls/${id}`);
    return this.parse(z.object({ firewall: FirewallSchema }), body).firewall;
  }

  async createFirewall(input: { name: string; labels: Record<string, string>; rules: FirewallRule[] }): Promise<Firewall> {
    const body = await this.request("POST", "/firewalls", {
      name: input.name,
      labels: input.labels,
      rules: input.rules.map(toRequestRule),
    });
    const parsed = this.parse(
      z.object({ firewall: FirewallSchema, actions: z.array(ActionSchema).default([]) }),
      body,
    );
    await this.waitForActions(parsed.actions);
    return parsed.firewall;
  }

  async setRules(id: number, rules: FirewallRule[]): Promise<Action[]> {
    const body = await this.request("POST", `/firewalls/${id}/actions/set_rules`, {
      rules: rules.map(toRequestRule),
    });
    const parsed = this.parse(z.object({ actions: z.array(ActionSchema).default([]) }), body);
    return this.waitForActions(parsed.actions);
  }

  async updateLabels(id: number, labels: Record<string, string>): Promise<Firewall> {
    const body = await this.request("PUT", `/firewalls/${id}`, { labels });
    return this.parse(z.object({ firewall: FirewallSchema }), body).firewall;
  }

  async listServers(): Promise<Server[]> {
    return this.listAll("/servers", "servers", ServerSchema);
  }

  async checkToken(): Promise<TokenCheck> {
    try {
      await this.request("GET", `/firewalls?per_page=1`);
    } catch (e) {
      if (e instanceof HetznerError) return { valid: false, writable: false, error: e };
      throw e;
    }
    try {
      await this.request("POST", "/firewalls", {});
      return { valid: true, writable: true };
    } catch (e) {
      if (!(e instanceof HetznerError)) throw e;
      if (e.code === "forbidden") return { valid: true, writable: false, error: e };
      if (e.code === "invalid_input" || e.code === "json_error") return { valid: true, writable: true };
      return { valid: true, writable: false, error: e };
    }
  }

  async waitForActions(actions: Action[]): Promise<Action[]> {
    const poll = this.opts.actionPollMs ?? 500;
    const deadline = this.now() + (this.opts.actionTimeoutMs ?? 60_000);
    const done: Action[] = [];
    for (let action of actions) {
      while (action.status === "running") {
        if (this.now() > deadline) {
          throw new HetznerError("timeout", `Action ${action.id} (${action.command}) läuft zu lange`);
        }
        await this.sleep(poll);
        const body = await this.request("GET", `/actions/${action.id}`);
        action = this.parse(z.object({ action: ActionSchema }), body).action;
      }
      if (action.status === "error") {
        throw new HetznerError(
          "action_failed",
          `${action.command}: ${action.error?.message ?? "fehlgeschlagen"}${action.error ? ` (${action.error.code})` : ""}`,
        );
      }
      done.push(action);
    }
    return done;
  }

  private async listAll<T>(path: string, key: string, item: z.ZodType<T>): Promise<T[]> {
    const schema = z.object({
      [key]: z.array(item),
      meta: z.object({ pagination: PaginationSchema }).optional(),
    });
    const out: T[] = [];
    let page: number | null = 1;
    while (page !== null) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await this.request("GET", `${path}${sep}page=${page}&per_page=${PER_PAGE}`);
      const parsed = this.parse(schema, body) as Record<string, unknown> & {
        meta?: { pagination: { next_page?: number | null } };
      };
      out.push(...(parsed[key] as T[]));
      page = parsed.meta?.pagination.next_page ?? null;
    }
    return out;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const r = schema.safeParse(body);
    if (!r.success) {
      throw new HetznerError("invalid_response", `Unerwartete Antwort der Hetzner-API: ${r.error.message}`);
    }
    return r.data;
  }

  private async request(method: string, path: string, body?: unknown, attempt = 0): Promise<unknown> {
    await this.respectRateLimit();
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 30_000),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new HetznerError("timeout", "Zeitüberschreitung bei der Hetzner-API");
      }
      throw new HetznerError("network", `Hetzner-API nicht erreichbar: ${String((e as Error)?.message ?? e)}`);
    }
    this.readRateLimit(res.headers);

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new HetznerError("invalid_response", "Antwort der Hetzner-API ist kein JSON", res.status);
      }
    }
    if (res.ok) return json;

    const err = ErrorBodySchema.safeParse(json);
    const code = err.success ? err.data.error.code : statusCode(res.status);
    const message = err.success ? err.data.error.message : `HTTP ${res.status}`;
    if (code === "rate_limit_exceeded" && attempt < 3) {
      await this.waitForReset(true);
      return this.request(method, path, body, attempt + 1);
    }
    throw new HetznerError(code, message, res.status);
  }

  private readRateLimit(headers: Headers) {
    const remaining = headers.get("RateLimit-Remaining");
    const reset = headers.get("RateLimit-Reset");
    if (remaining !== null && /^\d+$/.test(remaining)) this.rateLimitRemaining = Number(remaining);
    if (reset !== null && /^\d+$/.test(reset)) this.rateLimitReset = Number(reset) * 1000;
  }

  private async respectRateLimit() {
    if (this.rateLimitRemaining === 0) await this.waitForReset(false);
  }

  private async waitForReset(force: boolean) {
    const max = this.opts.maxRateLimitWaitMs ?? 60_000;
    const until = this.rateLimitReset ?? this.now() + (force ? 1000 : 0);
    const wait = Math.min(Math.max(until - this.now(), force ? 1000 : 0), max);
    if (wait > 0) await this.sleep(wait);
    this.rateLimitRemaining = null;
  }
}

function statusCode(status: number): string {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limit_exceeded";
    default:
      return status >= 500 ? "server_error" : "http_error";
  }
}

function toRequestRule(r: FirewallRule): Record<string, unknown> {
  const out: Record<string, unknown> = { direction: r.direction, protocol: r.protocol };
  if (r.direction === "in") out.source_ips = r.source_ips;
  else out.destination_ips = r.destination_ips;
  if ((r.protocol === "tcp" || r.protocol === "udp") && r.port) out.port = r.port;
  if (r.description) out.description = r.description;
  return out;
}
