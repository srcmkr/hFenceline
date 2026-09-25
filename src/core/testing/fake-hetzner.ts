import type { FetchFn } from "../hetzner/client";
import type { Firewall, FirewallRule, Server } from "../hetzner/types";

export interface FakeProject {
  firewalls: Firewall[];
  servers: Server[];
}

export class FakeHetzner {
  readonly projects = new Map<string, FakeProject>();
  homeIp = "203.0.113.7";
  failSetRules = new Set<number>();
  readonly writes: { token: string; method: string; path: string; body: unknown }[] = [];
  delayMs = 0;
  private nextId = 1000;

  project(token: string, data: Partial<FakeProject> = {}): FakeProject {
    const p = { firewalls: data.firewalls ?? [], servers: data.servers ?? [] };
    this.projects.set(token, p);
    return p;
  }

  fetch: FetchFn = async (url, init) => {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const u = new URL(url, "http://localhost");
    if (u.hostname === "api.ipify.org" || u.pathname.startsWith("/proxy/ipify")) {
      return new Response(`${this.homeIp}\n`, { status: 200 });
    }
    const method = init?.method ?? "GET";
    const path = u.pathname.replace(/^.*\/v1/, "");
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    const token = auth.replace(/^Bearer /, "");
    const project = this.projects.get(token);
    if (!project) return error(401, "unauthorized", "unable to authenticate");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") this.writes.push({ token, method, path, body });
    const readOnly = token.startsWith("ro-");

    const page = Number(u.searchParams.get("page") ?? 1);
    const perPage = Number(u.searchParams.get("per_page") ?? 25);
    const paginate = <T>(key: string, items: T[]) => {
      const start = (page - 1) * perPage;
      const last = Math.max(1, Math.ceil(items.length / perPage));
      return json(200, {
        [key]: items.slice(start, start + perPage),
        meta: {
          pagination: { page, per_page: perPage, previous_page: page > 1 ? page - 1 : null, next_page: page < last ? page + 1 : null, last_page: last, total_entries: items.length },
        },
      });
    };

    let m: RegExpExecArray | null;
    if (method === "GET" && path === "/firewalls") return paginate("firewalls", project.firewalls);
    if (method === "GET" && path === "/servers") return paginate("servers", project.servers);
    if ((m = /^\/firewalls\/(\d+)$/.exec(path))) {
      const fw = project.firewalls.find((f) => f.id === Number(m![1]));
      if (!fw) return error(404, "not_found", "firewall not found");
      if (method === "GET") return json(200, { firewall: fw });
      if (method === "PUT") {
        if (readOnly) return error(403, "forbidden", "insufficient permissions");
        if (body.labels) fw.labels = body.labels;
        if (body.name) fw.name = body.name;
        return json(200, { firewall: fw });
      }
    }
    if (method === "POST" && path === "/firewalls") {
      if (readOnly) return error(403, "forbidden", "insufficient permissions");
      if (!body?.name) return error(400, "invalid_input", "invalid input in field 'name'");
      if (project.firewalls.some((f) => f.name === body.name)) return error(409, "uniqueness_error", "name is already used");
      const fw: Firewall = { id: this.nextId++, name: body.name, labels: body.labels ?? {}, rules: (body.rules ?? []).map(fromRequest), applied_to: [] };
      project.firewalls.push(fw);
      return json(201, { firewall: fw, actions: [action(this.nextId++, "success")] });
    }
    if (method === "POST" && (m = /^\/firewalls\/(\d+)\/actions\/set_rules$/.exec(path))) {
      if (readOnly) return error(403, "forbidden", "insufficient permissions");
      const fw = project.firewalls.find((f) => f.id === Number(m![1]));
      if (!fw) return error(404, "not_found", "firewall not found");
      if (this.failSetRules.has(fw.id)) {
        return json(201, { actions: [action(this.nextId++, "error", { code: "firewall_resource_not_found", message: "firewall resource not found" })] });
      }
      fw.rules = (body.rules ?? []).map(fromRequest);
      return json(201, { actions: [action(this.nextId++, "running")] });
    }
    if (method === "GET" && (m = /^\/actions\/(\d+)$/.exec(path))) {
      return json(200, { action: action(Number(m[1]), "success") });
    }
    return error(404, "not_found", `${method} ${path}`);
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "RateLimit-Remaining": "3599" } });
}

function error(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}

function action(id: number, status: "running" | "success" | "error", error?: { code: string; message: string }) {
  return { id, command: "set_firewall_rules", status, progress: status === "running" ? 50 : 100, error: error ?? null };
}

function fromRequest(r: Record<string, unknown>): FirewallRule {
  return {
    direction: r.direction as "in" | "out",
    protocol: r.protocol as FirewallRule["protocol"],
    port: (r.port as string | undefined) ?? null,
    source_ips: (r.source_ips as string[] | undefined) ?? [],
    destination_ips: (r.destination_ips as string[] | undefined) ?? [],
    description: (r.description as string | undefined) ?? null,
  };
}

export function server(id: number, name: string, firewallIds: number[] = []): Server {
  return {
    id,
    name,
    status: "running",
    labels: {},
    public_net: { ipv4: { ip: `198.51.100.${id % 250}` }, firewalls: firewallIds.map((f) => ({ id: f, status: "applied" })) },
  };
}
