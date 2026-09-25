import type { Config, Customer, ManagedFirewall, Project, Template } from "../model/config";
import { findTemplate } from "../model/config";
import type { Firewall, Server } from "../hetzner/types";
import { MANAGED_LABEL_KEY, MANAGED_LABEL_VALUE } from "../hetzner/types";
import { HetznerError } from "../hetzner/client";
import { plan, type PlanResult } from "../plan/plan";
import { blockUsesHome } from "../plan/rules";
import { SOURCE_HOME } from "../model/config";

export type ProjectKey = string;
export type FirewallKey = string;

export const projectKey = (customerId: string, projectId: string): ProjectKey => `${customerId}/${projectId}`;
export const firewallKey = (customerId: string, projectId: string, hetznerId: number): FirewallKey =>
  `${customerId}/${projectId}/${hetznerId}`;

export type FirewallState = "unreachable" | "home-ip" | "drifted" | "foreign" | "ok" | "unknown";
export const STATE_ORDER: FirewallState[] = ["unreachable", "home-ip", "drifted", "foreign", "ok", "unknown"];

export type TrayColor = "green" | "yellow" | "red";

export interface ProjectData {
  loading: boolean;
  loadedAt?: string;
  error?: HetznerError;
  firewalls: Firewall[];
  servers: Server[];
}

export interface FirewallView {
  key: FirewallKey;
  customerId: string;
  projectId: string;
  hetznerId: number;
  name: string;
  config: ManagedFirewall;
  template?: Template;
  hetzner?: Firewall;
  plan?: PlanResult;
  error?: HetznerError | { code: "unknown_template"; message: string };
  states: FirewallState[];
  state: FirewallState;
  servers: Server[];
  usesHome: boolean;
}

export interface ProjectView {
  key: ProjectKey;
  customer: Customer;
  project: Project;
  data?: ProjectData;
  firewalls: FirewallView[];
  unmanaged: Firewall[];
  servers: Server[];
  unprotected: Server[];
  onlyUnmanaged: Server[];
  state: FirewallState;
}

export interface Overview {
  projects: ProjectView[];
  firewalls: FirewallView[];
  homeIp: string | null;
  homeIpChanged: boolean;
  homeIpTargets: FirewallView[];
  trayColor: TrayColor;
  hasErrors: boolean;
}

export interface OverviewInput {
  config: Config;
  homeIp: string | null;
  homeIpError?: string;
  data: Record<ProjectKey, ProjectData | undefined>;
  pendingDrops: Record<FirewallKey, string[] | undefined>;
}

export function isLabeledManaged(f: Firewall): boolean {
  return f.labels[MANAGED_LABEL_KEY] === MANAGED_LABEL_VALUE;
}

export function firewallUsesHome(template: Template, fw: ManagedFirewall): boolean {
  const blocks = template.blocks.filter((b) => !b.optional || (fw.blocks?.[b.id] ?? b.default ?? false));
  return blocks.some(blockUsesHome) || (fw.extra_rules ?? []).some((r) => r.from.includes(SOURCE_HOME));
}

function worst(states: FirewallState[]): FirewallState {
  for (const s of STATE_ORDER) if (states.includes(s)) return s;
  return "unknown";
}

export function buildOverview(input: OverviewInput): Overview {
  const { config, homeIp, data } = input;
  const projects: ProjectView[] = [];
  const all: FirewallView[] = [];

  for (const customer of config.customers) {
    for (const project of customer.projects) {
      const key = projectKey(customer.id, project.id);
      const d = data[key];
      const byId = new Map((d?.firewalls ?? []).map((f) => [f.id, f]));
      const managedIds = new Set(project.firewalls.map((f) => f.hetzner_id));

      const firewalls: FirewallView[] = project.firewalls.map((cfg) => {
        const fkey = firewallKey(customer.id, project.id, cfg.hetzner_id);
        const template = findTemplate(config, cfg.template);
        const hetzner = byId.get(cfg.hetzner_id);
        const servers = (d?.servers ?? []).filter((s) => s.public_net.firewalls.some((x) => x.id === cfg.hetzner_id));
        const view: FirewallView = {
          key: fkey,
          customerId: customer.id,
          projectId: project.id,
          hetznerId: cfg.hetzner_id,
          name: hetzner?.name ?? `Firewall #${cfg.hetzner_id}`,
          config: cfg,
          template,
          hetzner,
          states: [],
          state: "unknown",
          servers,
          usesHome: template ? firewallUsesHome(template, cfg) : false,
        };
        if (!template) {
          view.error = { code: "unknown_template", message: `Vorlage "${cfg.template}" fehlt` };
          view.states = ["unreachable"];
        } else if (d?.error) {
          view.error = d.error;
          view.states = ["unreachable"];
        } else if (d && !d.loading && !hetzner && d.loadedAt) {
          view.error = new HetznerError("not_found", "Firewall bei Hetzner nicht gefunden", 404);
          view.states = ["unreachable"];
        } else if (hetzner) {
          const p = plan({
            template,
            firewall: cfg,
            actual: hetzner.rules,
            homeIp,
            dropForeign: new Set(input.pendingDrops[fkey] ?? []),
          });
          view.plan = p;
          const s: FirewallState[] = [];
          if (p.status.homeIpOutdated) s.push("home-ip");
          if (p.status.drifted) s.push("drifted");
          if (p.status.hasForeign) s.push("foreign");
          if (s.length === 0) s.push("ok");
          view.states = s;
        }
        view.state = worst(view.states);
        return view;
      });

      const servers = d?.servers ?? [];
      const unprotected = servers.filter((s) => s.public_net.firewalls.length === 0);
      const onlyUnmanaged = servers.filter(
        (s) => s.public_net.firewalls.length > 0 && !s.public_net.firewalls.some((x) => managedIds.has(x.id)),
      );
      const unmanaged = (d?.firewalls ?? []).filter((f) => !managedIds.has(f.id));
      const projectStates = firewalls.map((f) => f.state);
      if (d?.error) projectStates.push("unreachable");
      if (unprotected.length > 0 || onlyUnmanaged.length > 0) projectStates.push("drifted");

      projects.push({
        key,
        customer,
        project,
        data: d,
        firewalls,
        unmanaged,
        servers,
        unprotected,
        onlyUnmanaged,
        state: projectStates.length ? worst(projectStates) : d?.loadedAt ? "ok" : "unknown",
      });
      all.push(...firewalls);
    }
  }

  const homeIpChanged = !!homeIp && homeIp !== config.homeip.last_applied;
  const homeIpTargets = all.filter((f) => f.usesHome);
  const hasErrors = !!input.homeIpError || projects.some((p) => p.state === "unreachable");
  const anyHome = (homeIpChanged && homeIpTargets.length > 0) || all.some((f) => f.states.includes("home-ip"));
  const anyYellow = projects.some((p) => p.state === "drifted") || all.some((f) => f.states.includes("drifted"));

  return {
    projects,
    firewalls: all,
    homeIp,
    homeIpChanged,
    homeIpTargets,
    trayColor: anyHome || hasErrors ? "red" : anyYellow ? "yellow" : "green",
    hasErrors,
  };
}
