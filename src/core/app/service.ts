import type { Config, ExtraRule, Language, ManagedFirewall } from "../model/config";
import { DEFAULT_CHECK_INTERVAL_MINUTES, findTemplate, slugify, tokenKey } from "../model/config";
import { defaultConfig } from "../model/defaults";
import { HetznerClient, HetznerError, type ClientOptions, type TokenCheck } from "../hetzner/client";
import { MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE, type Firewall, type FirewallRule } from "../hetzner/types";
import { fetchHomeIp, IPIFY_URL } from "../homeip/homeip";
import { ConfigError, ConfigStore } from "../store/config-store";
import { AuditLog, type AuditEntry, type AuditTrigger } from "../audit/audit";
import type { Ports } from "../ports";
import { plan, type PlanResult } from "../plan/plan";
import { homeIpOnlyRules } from "../plan/home";
import { suggestAssignment, type AssignResult } from "../plan/assign";
import { ruleKey, sourcesToFrom } from "../plan/rules";
import { hostCidr } from "../net/ip";
import { fetchLatestRelease, type Release } from "../update";
import {
  buildOverview,
  firewallKey,
  isLabeledManaged,
  projectKey,
  type FirewallKey,
  type Overview,
  type ProjectData,
  type ProjectKey,
} from "./overview";

export type Phase = "loading" | "first-run" | "ready" | "config-error";

export interface ServiceState {
  phase: Phase;
  configProblems?: string[];
  config: Config | null;
  homeIp: string | null;
  homeIpCheckedAt?: string;
  homeIpError?: string;
  homeIpLoading: boolean;
  data: Record<ProjectKey, ProjectData>;
  pendingDrops: Record<FirewallKey, string[]>;
  busy: Record<string, boolean>;
  overview: Overview | null;
}

export interface ApplyResult {
  key: FirewallKey;
  name: string;
  ok: boolean;
  unchanged?: boolean;
  error?: string;
  added: number;
  removed: number;
}

export interface ServiceOptions {
  apiBaseUrl?: string;
  ipUrl?: string;
  client?: Partial<Omit<ClientOptions, "token" | "fetch">>;
}

export type ForeignChoice = "keep" | "adopt" | "drop";

export class AppService {
  private state: ServiceState = {
    phase: "loading",
    config: null,
    homeIp: null,
    homeIpLoading: false,
    data: {},
    pendingDrops: {},
    busy: {},
    overview: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly configStore: ConfigStore;
  readonly audit: AuditLog;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ports: Ports,
    private readonly opts: ServiceOptions = {},
  ) {
    this.configStore = new ConfigStore(ports.files);
    this.audit = new AuditLog(ports.files);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): ServiceState => this.state;

  private set(patch: Partial<ServiceState>) {
    const next = { ...this.state, ...patch };
    next.overview = next.config
      ? buildOverview({
          config: next.config,
          homeIp: next.homeIp,
          homeIpError: next.homeIpError,
          data: next.data,
          pendingDrops: next.pendingDrops,
        })
      : null;
    this.state = next;
    for (const l of this.listeners) l();
  }

  private setProjectData(key: ProjectKey, patch: Partial<ProjectData>) {
    const prev = this.state.data[key] ?? { loading: false, firewalls: [], servers: [] };
    this.set({ data: { ...this.state.data, [key]: { ...prev, ...patch } } });
  }

  private config(): Config {
    if (!this.state.config) throw new Error("Keine Konfiguration geladen");
    return this.state.config;
  }

  private now(): string {
    return this.ports.now().toISOString();
  }

  async start(): Promise<void> {
    try {
      const config = await this.configStore.load();
      if (!config) {
        this.set({ phase: "first-run" });
        void this.refreshHomeIp();
        return;
      }
      this.set({ phase: "ready", config });
    } catch (e) {
      const problems = e instanceof ConfigError ? e.problems : [String(e)];
      this.set({ phase: "config-error", configProblems: problems });
      return;
    }
    await this.refreshHomeIp();
    await this.refreshAll();
  }

  async initConfig(language: Language): Promise<void> {
    const config = defaultConfig(language);
    await this.configStore.save(config);
    this.set({ phase: "ready", config });
  }

  async updateConfig(mutate: (draft: Config) => void): Promise<Config> {
    const draft = structuredClone(this.config());
    mutate(draft);
    await this.configStore.save(draft);
    this.set({ config: draft });
    return draft;
  }

  async updateFirewallConfig(key: FirewallKey, mutate: (fw: ManagedFirewall) => void): Promise<void> {
    const [customerId, projectId, id] = key.split("/");
    await this.updateConfig((c) => {
      const fw = c.customers
        .find((x) => x.id === customerId)
        ?.projects.find((x) => x.id === projectId)
        ?.firewalls.find((f) => f.hetzner_id === Number(id));
      if (!fw) throw new Error(`Firewall ${key} ist nicht konfiguriert`);
      mutate(fw);
      if (fw.blocks && Object.keys(fw.blocks).length === 0) delete fw.blocks;
      if (fw.static_ips?.length === 0) delete fw.static_ips;
      if (fw.extra_rules?.length === 0) delete fw.extra_rules;
    });
  }

  async refreshHomeIp(): Promise<string | null> {
    this.set({ homeIpLoading: true });
    try {
      const ip = await fetchHomeIp(this.ports.fetch, this.opts.ipUrl ?? IPIFY_URL);
      this.set({ homeIp: ip, homeIpError: undefined, homeIpLoading: false, homeIpCheckedAt: this.now() });
      return ip;
    } catch (e) {
      this.set({ homeIpError: (e as Error).message, homeIpLoading: false, homeIpCheckedAt: this.now() });
      return null;
    }
  }

  startHomeIpTimer(): void {
    this.stopHomeIpTimer();
    const minutes = this.state.config?.homeip.check_interval_minutes ?? DEFAULT_CHECK_INTERVAL_MINUTES;
    this.timer = setInterval(() => void this.refreshHomeIp(), minutes * 60_000);
  }

  stopHomeIpTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private makeClient(token: string): HetznerClient {
    return new HetznerClient({ ...this.opts.client, token, fetch: this.ports.fetch, baseUrl: this.opts.apiBaseUrl });
  }

  async clientFor(customerId: string, projectId: string): Promise<HetznerClient> {
    const token = await this.ports.secrets.get(tokenKey(customerId, projectId));
    if (!token) throw new HetznerError("unauthorized", "Kein Token hinterlegt");
    return this.makeClient(token);
  }

  async checkToken(token: string): Promise<TokenCheck> {
    return this.makeClient(token.trim()).checkToken();
  }

  async hasToken(customerId: string, projectId: string): Promise<boolean> {
    return (await this.ports.secrets.get(tokenKey(customerId, projectId))) !== null;
  }

  async addProject(
    input: {
      customerId?: string;
      customerName?: string;
      projectName: string;
      token: string;
      consoleProjectId?: number;
    },
    opts: { allowFile?: boolean } = {},
  ): Promise<{ customerId: string; projectId: string }> {
    const config = this.config();
    const existing = input.customerId ? config.customers.find((x) => x.id === input.customerId) : undefined;
    const customerName = input.customerName?.trim() || input.projectName.trim();
    const customerId = existing?.id ?? slugify(customerName, config.customers.map((x) => x.id));
    const projectId = slugify(input.projectName, existing?.projects.map((p) => p.id) ?? []);

    await this.ports.secrets.set(tokenKey(customerId, projectId), input.token.trim(), opts);
    await this.updateConfig((c) => {
      let customer = c.customers.find((x) => x.id === customerId);
      if (!customer) {
        customer = { id: customerId, name: customerName, projects: [] };
        c.customers.push(customer);
      }
      customer.projects.push({
        id: projectId,
        name: input.projectName.trim(),
        ...(input.consoleProjectId ? { console_project_id: input.consoleProjectId } : {}),
        firewalls: [],
      });
    });
    return { customerId, projectId };
  }

  async setToken(customerId: string, projectId: string, token: string, opts: { allowFile?: boolean } = {}): Promise<void> {
    await this.ports.secrets.set(tokenKey(customerId, projectId), token.trim(), opts);
    await this.refreshProject(customerId, projectId);
  }

  async setConsoleProjectId(customerId: string, projectId: string, id: number | undefined): Promise<void> {
    await this.updateConfig((c) => {
      const p = c.customers.find((x) => x.id === customerId)?.projects.find((x) => x.id === projectId);
      if (!p) return;
      if (id) p.console_project_id = id;
      else delete p.console_project_id;
    });
  }

  async removeProject(customerId: string, projectId: string): Promise<void> {
    await this.updateConfig((c) => {
      const customer = c.customers.find((x) => x.id === customerId);
      if (!customer) return;
      customer.projects = customer.projects.filter((p) => p.id !== projectId);
      if (customer.projects.length === 0) c.customers = c.customers.filter((x) => x.id !== customerId);
    });
    await this.ports.secrets.delete(tokenKey(customerId, projectId));
    const data = { ...this.state.data };
    delete data[projectKey(customerId, projectId)];
    this.set({ data });
  }

  async refreshProject(customerId: string, projectId: string): Promise<void> {
    const key = projectKey(customerId, projectId);
    this.setProjectData(key, { loading: true });
    try {
      const client = await this.clientFor(customerId, projectId);
      const [firewalls, servers] = await Promise.all([client.listFirewalls(), client.listServers()]);
      this.setProjectData(key, { loading: false, error: undefined, firewalls, servers, loadedAt: this.now() });
    } catch (e) {
      const error = e instanceof HetznerError ? e : new HetznerError("network", String((e as Error)?.message ?? e));
      this.setProjectData(key, { loading: false, error, loadedAt: this.now() });
    }
  }

  async refreshAll(): Promise<void> {
    const config = this.state.config;
    if (!config) return;
    await Promise.all(
      config.customers.flatMap((c) => c.projects.map((p) => this.refreshProject(c.id, p.id))),
    );
  }

  private locate(key: FirewallKey) {
    const [customerId, projectId, id] = key.split("/");
    const hetznerId = Number(id);
    const config = this.config();
    const customer = config.customers.find((c) => c.id === customerId);
    const project = customer?.projects.find((p) => p.id === projectId);
    const fw = project?.firewalls.find((f) => f.hetzner_id === hetznerId);
    if (!customer || !project || !fw) throw new Error(`Firewall ${key} ist nicht konfiguriert`);
    const template = findTemplate(config, fw.template);
    if (!template) throw new Error(`Vorlage "${fw.template}" fehlt`);
    return { customer, project, fw, template, hetznerId };
  }

  private async withBusy<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.state.busy[id]) throw new Error("Vorgang läuft bereits");
    this.set({ busy: { ...this.state.busy, [id]: true } });
    try {
      return await fn();
    } finally {
      const busy = { ...this.state.busy };
      delete busy[id];
      this.set({ busy });
    }
  }

  private storeFirewall(customerId: string, projectId: string, firewall: Firewall) {
    const key = projectKey(customerId, projectId);
    const d = this.state.data[key];
    if (!d) return;
    const exists = d.firewalls.some((f) => f.id === firewall.id);
    const firewalls = exists ? d.firewalls.map((f) => (f.id === firewall.id ? firewall : f)) : [...d.firewalls, firewall];
    this.setProjectData(key, { firewalls });
  }

  async preview(key: FirewallKey): Promise<{ firewall: Firewall; plan: PlanResult }> {
    const { customer, project, fw, template, hetznerId } = this.locate(key);
    const client = await this.clientFor(customer.id, project.id);
    const firewall = await client.getFirewall(hetznerId);
    this.storeFirewall(customer.id, project.id, firewall);
    const p = plan({
      template,
      firewall: fw,
      actual: firewall.rules,
      homeIp: this.state.homeIp,
      dropForeign: new Set(this.state.pendingDrops[key] ?? []),
    });
    return { firewall, plan: p };
  }

  async applyFirewall(key: FirewallKey, trigger: AuditTrigger = "apply"): Promise<ApplyResult> {
    return this.withBusy(key, async () => {
      const { customer, project } = this.locate(key);
      let name = key;
      try {
        const { firewall, plan: p } = await this.preview(key);
        name = firewall.name;
        await this.ensureLabel(customer.id, project.id, firewall, trigger);
        if (p.added.length === 0 && p.removed.length === 0) {
          this.clearDrops(key);
          return { key, name, ok: true, unchanged: true, added: 0, removed: 0 };
        }
        await this.writeRules(customer.id, project.id, firewall, p.rules, trigger);
        this.clearDrops(key);
        return { key, name, ok: true, added: p.added.length, removed: p.removed.length };
      } catch (e) {
        return { key, name, ok: false, error: (e as Error).message, added: 0, removed: 0 };
      }
    });
  }

  async applyHomeIp(keys?: FirewallKey[]): Promise<ApplyResult[]> {
    const homeIp = this.state.homeIp;
    if (!homeIp) throw new Error("Home-IP unbekannt");
    const targets = (this.state.overview?.homeIpTargets ?? [])
      .map((f) => f.key)
      .filter((k) => !keys || keys.includes(k));

    const byProject = new Map<string, FirewallKey[]>();
    for (const k of targets) {
      const p = k.split("/").slice(0, 2).join("/");
      byProject.set(p, [...(byProject.get(p) ?? []), k]);
    }
    const results = (
      await Promise.all(
        [...byProject.values()].map(async (list) => {
          const out: ApplyResult[] = [];
          for (const k of list) out.push(await this.applyHomeIpTo(k, homeIp));
          return out;
        }),
      )
    ).flat();

    const stillOutdated = this.state.overview?.firewalls.some((f) => f.usesHome && f.states.includes("home-ip"));
    if (results.every((r) => r.ok) && !stillOutdated) {
      await this.updateConfig((c) => {
        c.homeip.last_applied = homeIp;
      });
    }
    return results;
  }

  private async applyHomeIpTo(key: FirewallKey, homeIp: string): Promise<ApplyResult> {
    return this.withBusy(key, async () => {
      let name = key;
      try {
        const { customer, project, fw, template, hetznerId } = this.locate(key);
        const client = await this.clientFor(customer.id, project.id);
        const firewall = await client.getFirewall(hetznerId);
        name = firewall.name;
        const r = homeIpOnlyRules(template, fw, firewall.rules, homeIp);
        if (r.added.length === 0 && r.removed.length === 0) {
          this.storeFirewall(customer.id, project.id, firewall);
          return { key, name, ok: true, unchanged: true, added: 0, removed: 0 };
        }
        await this.writeRules(customer.id, project.id, firewall, r.rules, "home-ip");
        return { key, name, ok: true, added: r.added.length, removed: r.removed.length };
      } catch (e) {
        return { key, name, ok: false, error: (e as Error).message, added: 0, removed: 0 };
      }
    });
  }

  private async writeRules(
    customerId: string,
    projectId: string,
    firewall: Firewall,
    rules: FirewallRule[],
    trigger: AuditTrigger,
  ): Promise<void> {
    const client = await this.clientFor(customerId, projectId);
    const entry: AuditEntry = {
      time: this.now(),
      action: "set_rules",
      trigger,
      customer: customerId,
      project: projectId,
      firewall_id: firewall.id,
      firewall_name: firewall.name,
      old_rules: firewall.rules,
      new_rules: rules,
      result: "ok",
    };
    try {
      await client.setRules(firewall.id, rules);
    } catch (e) {
      await this.audit.append({ ...entry, result: "error", error: (e as Error).message });
      throw e;
    }
    await this.audit.append(entry);
    this.storeFirewall(customerId, projectId, await client.getFirewall(firewall.id));
  }

  private async ensureLabel(customerId: string, projectId: string, firewall: Firewall, trigger: AuditTrigger) {
    if (isLabeledManaged(firewall)) return;
    const labels = { ...firewall.labels, [MANAGED_LABEL_KEY]: MANAGED_LABEL_VALUE };
    await this.writeLabels(customerId, projectId, firewall, labels, trigger);
  }

  private async writeLabels(
    customerId: string,
    projectId: string,
    firewall: Firewall,
    labels: Record<string, string>,
    trigger: AuditTrigger,
  ) {
    const client = await this.clientFor(customerId, projectId);
    const entry: AuditEntry = {
      time: this.now(),
      action: "labels",
      trigger,
      customer: customerId,
      project: projectId,
      firewall_id: firewall.id,
      firewall_name: firewall.name,
      old_labels: firewall.labels,
      new_labels: labels,
      result: "ok",
    };
    try {
      const updated = await client.updateLabels(firewall.id, labels);
      await this.audit.append(entry);
      this.storeFirewall(customerId, projectId, updated);
      firewall.labels = updated.labels;
    } catch (e) {
      await this.audit.append({ ...entry, result: "error", error: (e as Error).message });
      throw e;
    }
  }

  private clearDrops(key: FirewallKey) {
    if (!this.state.pendingDrops[key]) return;
    const pendingDrops = { ...this.state.pendingDrops };
    delete pendingDrops[key];
    this.set({ pendingDrops });
  }

  previewNew(templateId: string, settings: Omit<ManagedFirewall, "hetzner_id" | "template">): PlanResult {
    const template = findTemplate(this.config(), templateId);
    if (!template) throw new Error(`Vorlage "${templateId}" fehlt`);
    return plan({ template, firewall: { hetzner_id: 1, template: templateId, ...settings }, actual: [], homeIp: this.state.homeIp });
  }

  async createFirewall(input: {
    customerId: string;
    projectId: string;
    name: string;
    templateId: string;
    settings: Omit<ManagedFirewall, "hetzner_id" | "template">;
  }): Promise<Firewall> {
    const p = this.previewNew(input.templateId, input.settings);
    const client = await this.clientFor(input.customerId, input.projectId);
    const labels = { [MANAGED_LABEL_KEY]: MANAGED_LABEL_VALUE };
    const entry: AuditEntry = {
      time: this.now(),
      action: "create",
      trigger: "create",
      customer: input.customerId,
      project: input.projectId,
      firewall_id: null,
      firewall_name: input.name,
      new_rules: p.rules,
      new_labels: labels,
      result: "ok",
    };
    let created: Firewall;
    try {
      created = await client.createFirewall({ name: input.name, labels, rules: p.rules });
    } catch (e) {
      await this.audit.append({ ...entry, result: "error", error: (e as Error).message });
      throw e;
    }
    await this.audit.append({ ...entry, firewall_id: created.id });
    await this.updateConfig((c) => {
      const project = c.customers.find((x) => x.id === input.customerId)?.projects.find((x) => x.id === input.projectId);
      project?.firewalls.push({ hetzner_id: created.id, template: input.templateId, ...input.settings });
    });
    this.storeFirewall(input.customerId, input.projectId, created);
    return created;
  }

  suggest(templateId: string, firewall: Firewall, homeSource?: string | null): AssignResult {
    const template = findTemplate(this.config(), templateId);
    if (!template) throw new Error(`Vorlage "${templateId}" fehlt`);
    return suggestAssignment({
      template,
      actual: firewall.rules,
      homeIp: this.state.homeIp,
      lastHomeIp: this.config().homeip.last_applied,
      homeSource,
    });
  }

  async manageFirewall(input: {
    customerId: string;
    projectId: string;
    firewall: Firewall;
    templateId: string;
    assignment: AssignResult;
  }): Promise<FirewallKey> {
    const key = firewallKey(input.customerId, input.projectId, input.firewall.id);
    await this.updateConfig((c) => {
      const project = c.customers.find((x) => x.id === input.customerId)?.projects.find((x) => x.id === input.projectId);
      if (!project) throw new Error("Projekt fehlt");
      project.firewalls = project.firewalls.filter((f) => f.hetzner_id !== input.firewall.id);
      project.firewalls.push({ hetzner_id: input.firewall.id, template: input.templateId, ...input.assignment.settings });
    });
    this.set({
      pendingDrops: { ...this.state.pendingDrops, [key]: input.assignment.covered.map(ruleKey) },
    });
    return key;
  }

  async unmanageFirewall(key: FirewallKey): Promise<void> {
    const { customer, project, hetznerId } = this.locate(key);
    const firewall = this.state.data[projectKey(customer.id, project.id)]?.firewalls.find((f) => f.id === hetznerId);
    if (firewall && isLabeledManaged(firewall)) {
      const labels = { ...firewall.labels };
      delete labels[MANAGED_LABEL_KEY];
      await this.writeLabels(customer.id, project.id, firewall, labels, "apply");
    }
    await this.updateConfig((c) => {
      const p = c.customers.find((x) => x.id === customer.id)?.projects.find((x) => x.id === project.id);
      if (p) p.firewalls = p.firewalls.filter((f) => f.hetzner_id !== hetznerId);
    });
    this.clearDrops(key);
  }

  async adoptActual(key: FirewallKey): Promise<void> {
    const { customer, project, fw, template } = this.locate(key);
    const firewall = this.state.data[projectKey(customer.id, project.id)]?.firewalls.find((f) => f.id === fw.hetzner_id);
    if (!firewall) throw new Error("Ist-Stand nicht geladen");
    const homeIp = this.state.homeIp;
    const homeInActual = homeIp && firewall.rules.some((r) => r.source_ips.includes(hostCidr(homeIp)));
    const r = suggestAssignment({
      template,
      actual: firewall.rules.filter((x) => (x.description ?? "").startsWith("hfl:")),
      homeIp,
      lastHomeIp: this.config().homeip.last_applied,
      homeSource: homeInActual ? hostCidr(homeIp!) : undefined,
      previous: fw,
    });
    await this.updateConfig((c) => {
      const p = c.customers.find((x) => x.id === customer.id)?.projects.find((x) => x.id === project.id);
      const target = p?.firewalls.find((f) => f.hetzner_id === fw.hetzner_id);
      if (!target) return;
      delete target.blocks;
      delete target.static_ips;
      delete target.extra_rules;
      Object.assign(target, r.settings);
    });
  }

  async setForeignChoice(key: FirewallKey, rule: FirewallRule, choice: ForeignChoice): Promise<void> {
    const rk = ruleKey(rule);
    const drops = new Set(this.state.pendingDrops[key] ?? []);
    if (choice === "keep") drops.delete(rk);
    else drops.add(rk);
    this.set({ pendingDrops: { ...this.state.pendingDrops, [key]: [...drops] } });
    if (choice === "adopt") {
      const { customer, project, fw } = this.locate(key);
      await this.updateConfig((c) => {
        const target = c.customers
          .find((x) => x.id === customer.id)
          ?.projects.find((x) => x.id === project.id)
          ?.firewalls.find((f) => f.hetzner_id === fw.hetzner_id);
        if (!target) return;
        const name = rule.description?.trim() || `${rule.protocol.toUpperCase()} ${rule.port ?? ""}`.trim();
        const extra: ExtraRule = { name, protocol: rule.protocol, from: sourcesToFrom(rule.source_ips) };
        if (rule.port) extra.port = rule.port;
        const same = (x: ExtraRule) =>
          x.protocol === extra.protocol && x.port === extra.port && x.from.join(",") === extra.from.join(",");
        if ((target.extra_rules ?? []).some(same)) return;
        target.extra_rules = [...(target.extra_rules ?? []), extra];
      });
    }
  }

  async storageInfo(): Promise<{ location: string; secrets: string }> {
    const [location, secrets] = await Promise.all([
      this.ports.files.location(),
      this.ports.secrets.backend().catch(() => "unknown"),
    ]);
    return { location, secrets };
  }

  latestRelease(repo: string): Promise<Release | null> {
    return fetchLatestRelease(this.ports.fetch, repo);
  }

  async auditEntries(): Promise<AuditEntry[]> {
    return this.audit.readAll();
  }
}
