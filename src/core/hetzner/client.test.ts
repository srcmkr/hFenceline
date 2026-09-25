import { describe, expect, it } from "vitest";
import { HetznerClient, HetznerError, isUnreachable, type FetchFn } from "./client";
import type { FirewallRule } from "./types";

function fakeApi(routes: Record<string, Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fetch: FetchFn = async (url, init) => {
    const path = url.replace("https://api.hetzner.cloud/v1", "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get("Authorization") });
    const queue = routes[`${method} ${path}`];
    const next = queue?.shift();
    if (!next) return new Response(JSON.stringify({ error: { code: "not_found", message: `keine Route ${method} ${path}` } }), { status: 404 });
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers,
    });
  };
  return { fetch, calls };
}

function client(fetch: FetchFn, extra: Partial<ConstructorParameters<typeof HetznerClient>[0]> = {}) {
  const slept: number[] = [];
  let clock = 1_700_000_000_000;
  const c = new HetznerClient({
    token: "secret",
    fetch,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...extra,
  });
  return { c, slept };
}

const fw = (id: number, rules: FirewallRule[] = []) => ({ id, name: `fw-${id}`, labels: {}, rules, applied_to: [] });
const page = (n: number, next: number | null) => ({ pagination: { page: n, per_page: 50, next_page: next, previous_page: null, last_page: 2, total_entries: 3 } });
const action = (id: number, status: "running" | "success" | "error", error?: { code: string; message: string }) => ({
  id,
  command: "set_firewall_rules",
  status,
  progress: status === "running" ? 0 : 100,
  error: error ?? null,
});

describe("HetznerClient", () => {
  it("pagination", async () => {
    const api = fakeApi({
      "GET /firewalls?page=1&per_page=50": [{ body: { firewalls: [fw(1), fw(2)], meta: page(1, 2) } }],
      "GET /firewalls?page=2&per_page=50": [{ body: { firewalls: [fw(3)], meta: page(2, null) } }],
    });
    const { c } = client(api.fetch);
    const list = await c.listFirewalls();
    expect(list.map((f) => f.id)).toEqual([1, 2, 3]);
    expect(api.calls.every((x) => x.auth === "Bearer secret")).toBe(true);
  });

  it("setRules", async () => {
    const api = fakeApi({
      "POST /firewalls/7/actions/set_rules": [{ status: 201, body: { actions: [action(10, "running"), action(11, "success")] } }],
      "GET /actions/10": [{ body: { action: action(10, "running") } }, { body: { action: action(10, "success") } }],
    });
    const { c, slept } = client(api.fetch, { actionPollMs: 250 });
    const rules: FirewallRule[] = [
      { direction: "in", protocol: "icmp", port: null, source_ips: ["0.0.0.0/0"], destination_ips: [], description: "hfl:ping Ping" },
      { direction: "in", protocol: "tcp", port: "22", source_ips: ["1.2.3.4/32"], destination_ips: [], description: "" },
      { direction: "out", protocol: "tcp", port: "25", source_ips: [], destination_ips: ["0.0.0.0/0"], description: null },
    ];
    const done = await c.setRules(7, rules);
    expect(done.map((a) => a.status)).toEqual(["success", "success"]);
    expect(slept).toEqual([250, 250]);
    expect(api.calls[0]!.body).toEqual({
      rules: [
        { direction: "in", protocol: "icmp", source_ips: ["0.0.0.0/0"], description: "hfl:ping Ping" },
        { direction: "in", protocol: "tcp", port: "22", source_ips: ["1.2.3.4/32"] },
        { direction: "out", protocol: "tcp", port: "25", destination_ips: ["0.0.0.0/0"] },
      ],
    });
  });

  it("meldet fehlgeschlagene Actions", async () => {
    const api = fakeApi({
      "POST /firewalls/7/actions/set_rules": [
        { status: 201, body: { actions: [action(10, "error", { code: "firewall_resource_not_found", message: "weg" })] } },
      ],
    });
    const { c } = client(api.fetch);
    await expect(c.setRules(7, [])).rejects.toMatchObject({ code: "action_failed" });
  });

  it("bricht zu lange laufende Actions ab", async () => {
    const api = fakeApi({
      "POST /firewalls/7/actions/set_rules": [{ status: 201, body: { actions: [action(10, "running")] } }],
      "GET /actions/10": Array.from({ length: 10 }, () => ({ body: { action: action(10, "running") } })),
    });
    const { c } = client(api.fetch, { actionPollMs: 1000, actionTimeoutMs: 3000 });
    await expect(c.setRules(7, [])).rejects.toMatchObject({ code: "timeout" });
  });

  it("übersetzt Fehler der API", async () => {
    const api = fakeApi({
      "GET /firewalls/1": [{ status: 401, body: { error: { code: "unauthorized", message: "unable to authenticate" } } }],
      "GET /firewalls/2": [{ status: 404, body: { error: { code: "not_found", message: "firewall not found" } } }],
      "GET /firewalls/3": [{ status: 502 }],
    });
    const { c } = client(api.fetch);
    const e1 = await c.getFirewall(1).catch((e) => e);
    expect(e1).toBeInstanceOf(HetznerError);
    expect(e1).toMatchObject({ code: "unauthorized", status: 401 });
    expect(isUnreachable(e1)).toBe(true);
    await expect(c.getFirewall(2)).rejects.toMatchObject({ code: "not_found" });
    await expect(c.getFirewall(3)).rejects.toMatchObject({ code: "server_error", status: 502 });
  });

  it("netzwerkfehler", async () => {
    const { c } = client(async () => {
      throw new TypeError("fetch failed");
    });
    const e = await c.listServers().catch((x) => x);
    expect(e).toMatchObject({ code: "network" });
    expect(isUnreachable(e)).toBe(true);
  });

  it("kaputte antwort", async () => {
    const api = fakeApi({ "GET /firewalls/1": [{ body: { firewall: { id: "x" } } }] });
    const { c } = client(api.fetch);
    await expect(c.getFirewall(1)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rate limit 429", async () => {
    const reset = String(Math.floor(1_700_000_000_000 / 1000) + 5);
    const api = fakeApi({
      "GET /firewalls/1": [
        { status: 429, body: { error: { code: "rate_limit_exceeded", message: "limit" } }, headers: { "RateLimit-Remaining": "0", "RateLimit-Reset": reset } },
        { body: { firewall: fw(1) } },
      ],
    });
    const { c, slept } = client(api.fetch);
    const f = await c.getFirewall(1);
    expect(f.id).toBe(1);
    expect(slept).toEqual([5000]);
  });

  it("rate limit header", async () => {
    const reset = String(Math.floor(1_700_000_000_000 / 1000) + 2);
    const api = fakeApi({
      "GET /firewalls/1": [{ body: { firewall: fw(1) }, headers: { "RateLimit-Remaining": "0", "RateLimit-Reset": reset } }],
      "GET /firewalls/2": [{ body: { firewall: fw(2) } }],
    });
    const { c, slept } = client(api.fetch);
    await c.getFirewall(1);
    await c.getFirewall(2);
    expect(slept).toEqual([2000]);
  });

  describe("checkToken", () => {
    const ok = { body: { firewalls: [], meta: page(1, null) } };
    it("Lese-/Schreib-Token", async () => {
      const api = fakeApi({
        "GET /firewalls?per_page=1": [ok],
        "POST /firewalls": [{ status: 400, body: { error: { code: "invalid_input", message: "invalid input in field 'name'" } } }],
      });
      expect(await client(api.fetch).c.checkToken()).toEqual({ valid: true, writable: true });
    });
    it("Lese-Token", async () => {
      const api = fakeApi({
        "GET /firewalls?per_page=1": [ok],
        "POST /firewalls": [{ status: 403, body: { error: { code: "forbidden", message: "insufficient permissions" } } }],
      });
      expect(await client(api.fetch).c.checkToken()).toMatchObject({ valid: true, writable: false });
    });
    it("ungültiges Token", async () => {
      const api = fakeApi({
        "GET /firewalls?per_page=1": [{ status: 401, body: { error: { code: "unauthorized", message: "unable to authenticate" } } }],
      });
      const r = await client(api.fetch).c.checkToken();
      expect(r).toMatchObject({ valid: false, writable: false });
      expect(r.error?.code).toBe("unauthorized");
      expect(api.calls).toHaveLength(1);
    });
  });

  it("legt Firewalls mit Labels an", async () => {
    const api = fakeApi({
      "POST /firewalls": [{ status: 201, body: { firewall: fw(9), actions: [action(1, "success")] } }],
    });
    const { c } = client(api.fetch);
    const f = await c.createFirewall({ name: "web-standard", labels: { "managed-by": "hfenceline" }, rules: [] });
    expect(f.id).toBe(9);
    expect(api.calls[0]!.body).toEqual({ name: "web-standard", labels: { "managed-by": "hfenceline" }, rules: [] });
  });
});
