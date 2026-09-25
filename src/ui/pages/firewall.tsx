import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  CircleCheck,
  ExternalLink,
  Layers,
  ListPlus,
  MoreHorizontal,
  Network,
  Server as ServerIcon,
  ShieldQuestion,
  Unlink,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FirewallView } from "@/core/app/overview";
import type { ForeignChoice } from "@/core/app/service";
import type { FirewallRule } from "@/core/hetzner/types";
import { normalizeCidr } from "@/core/net/ip";
import { normalizeRule, sourcesToFrom } from "@/core/plan/rules";
import { useService, useServiceState } from "../service-context";
import { PageHeader, Section } from "../section";
import { StatusBadge } from "../status";
import { BlockToggles, ExtraRulesEditor, StaticIpEditor } from "../editors";
import { RuleDiff, PlanWarnings } from "../preview";
import { RuleRow, type SourceContext } from "../rules";
import { errorText, useAction } from "../errors";
import { PreviewDialog } from "../dialogs/preview-dialog";
import { ConfirmDialog } from "../dialogs/confirm-dialog";
import { consoleUrl, openUrl } from "@/platform/desktop";
import { useNav } from "../navigation";

export function FirewallPage({ view }: { view: FirewallView }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const nav = useNav();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmUnmanage, setConfirmUnmanage] = useState(false);
  const [confirmAdopt, setConfirmAdopt] = useState(false);

  const config = state.config!;
  const project = state.overview!.projects.find((p) => p.key === view.key.split("/").slice(0, 2).join("/"))!;
  const plan = view.plan;
  const pending = state.pendingDrops[view.key] ?? [];
  const writing = !!state.busy[view.key];

  const [save] = useAction((mutate: Parameters<typeof service.updateFirewallConfig>[1]) => service.updateFirewallConfig(view.key, mutate));
  const [adopt] = useAction(() => service.adoptActual(view.key));
  const [unmanage] = useAction(async () => {
    await service.unmanageFirewall(view.key);
    nav.go({ kind: "project", key: project.key });
  });
  const [foreignChoice] = useAction((rule: FirewallRule, choice: ForeignChoice) => service.setForeignChoice(view.key, rule, choice));

  const notes = new Map((view.config.static_ips ?? []).map((s) => [normalizeCidr(s.cidr), s.note]));
  const ctx: SourceContext = { homeIp: state.homeIp, notes };
  const canApply = !!plan && (!plan.status.inSync || pending.length > 0);
  const err = view.error ? errorText(t, view.error) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        subtitle={`${project.customer.name} · ${project.project.name}`}
        title={view.name}
        badges={view.states.filter((s) => s !== "unknown").map((s) => <StatusBadge key={s} state={s} />)}
        actions={
          <>
            <Button onClick={() => setPreviewOpen(true)} disabled={!view.hetzner || writing} variant={canApply ? "default" : "outline"}>
              <Upload className="size-4" />
              {t("firewall.apply")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("common.more")}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled={!view.hetzner || plan?.status.inSync} onSelect={() => setConfirmAdopt(true)}>
                  <ArrowDownToLine className="size-4" />
                  {t("firewall.adoptActual")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void openUrl(consoleUrl(project.project.console_project_id))}>
                  <ExternalLink className="size-4" />
                  {t("firewall.openConsole")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmUnmanage(true)}>
                  <Unlink className="size-4" />
                  {t("firewall.unmanage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {err && (
        <Alert variant="destructive">
          <ShieldQuestion />
          <AlertTitle>{err.title}</AlertTitle>
          <AlertDescription>{err.detail}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Section
            title={t("firewall.template")}
            icon={<Layers />}
            description={t("firewall.templateHint")}
            actions={
              <Select value={view.config.template} onValueChange={(v) => void save((fw) => void (fw.template = v))}>
                <SelectTrigger size="sm" className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {view.template ? (
              <BlockToggles
                template={view.template}
                blocks={view.config.blocks}
                onChange={(blocks) => void save((fw) => void (fw.blocks = blocks))}
              />
            ) : (
              <p className="p-4 text-sm text-destructive">{t("errors.unknownTemplate")}</p>
            )}
          </Section>

          <Section title={t("staticIps.title")} icon={<Network />} description={t("staticIps.hint")}>
            <StaticIpEditor
              value={view.config.static_ips ?? []}
              onChange={(next) => void save((fw) => void (fw.static_ips = next))}
            />
          </Section>

          <Section title={t("extraRules.title")} icon={<ListPlus />} description={t("extraRules.hint")}>
            <ExtraRulesEditor
              value={view.config.extra_rules ?? []}
              onChange={(next) => void save((fw) => void (fw.extra_rules = next))}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section
            title={t("firewall.sync")}
            description={plan ? (plan.status.inSync ? t("firewall.syncOk") : t("firewall.syncDiff")) : undefined}
            icon={<CircleCheck />}
          >
            {!plan && !err && <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>}
            {plan && plan.status.inSync && pending.length === 0 ? (
              <div className="flex items-center gap-3 p-4 text-sm">
                <CircleCheck className="size-5 text-emerald-500" />
                {t("firewall.inSync")}
              </div>
            ) : (
              plan &&
              view.hetzner && (
                <div className="space-y-3 p-4">
                  <PlanWarnings warnings={plan.warnings} />
                  <RuleDiff before={view.hetzner.rules} after={plan.rules} ctx={ctx} />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirmAdopt(true)}>
                      <ArrowDownToLine className="size-4" />
                      {t("firewall.adoptActual")}
                    </Button>
                    <Button size="sm" onClick={() => setPreviewOpen(true)} disabled={writing}>
                      <Upload className="size-4" />
                      {t("firewall.applyTarget")}
                    </Button>
                  </div>
                </div>
              )
            )}
          </Section>

          <Section title={t("foreign.title")} description={t("foreign.hint")} icon={<ShieldQuestion />}>
            {!plan || plan.foreign.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t("foreign.empty")}</p>
            ) : (
              <div className="divide-y">
                {plan.foreign.map((f, i) => (
                  <RuleRow
                    key={`${f.key}-${i}`}
                    rule={f.rule}
                    ctx={ctx}
                    change={f.drop ? "removed" : undefined}
                    actions={
                      <ForeignSwitch
                        value={f.drop ? (isAdopted(view, f.rule) ? "adopt" : "drop") : "keep"}
                        onChange={(c) => void foreignChoice(f.rule, c)}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title={t("servers.protected")} icon={<ServerIcon />} description={t("servers.protectedHint")}>
            {view.servers.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t("servers.noneProtected")}</p>
            ) : (
              <div className="divide-y">
                {view.servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={cn("size-2 rounded-full", s.status === "running" ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                    <span className="font-medium">{s.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.public_net.ipv4?.ip}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {view.hetzner?.applied_to.some((a) => a.type === "label_selector") ? t("servers.viaLabel") : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {view.hetzner && <PreviewDialog fwKey={view.key} open={previewOpen} onOpenChange={setPreviewOpen} />}
      <ConfirmDialog
        open={confirmUnmanage}
        onOpenChange={setConfirmUnmanage}
        title={t("firewall.unmanageTitle", { name: view.name })}
        description={t("firewall.unmanageText")}
        confirmLabel={t("firewall.unmanage")}
        destructive
        onConfirm={() => unmanage()}
      />
      <ConfirmDialog
        open={confirmAdopt}
        onOpenChange={setConfirmAdopt}
        title={t("firewall.adoptActualTitle")}
        description={t("firewall.adoptActualText")}
        confirmLabel={t("firewall.adoptActual")}
        onConfirm={() => adopt()}
      />
    </div>
  );
}

function isAdopted(view: FirewallView, rule: FirewallRule): boolean {
  const n = normalizeRule(rule);
  const from = sourcesToFrom(n.source_ips).join(",");
  return (view.config.extra_rules ?? []).some(
    (x) => x.protocol === n.protocol && (x.port ?? null) === (n.protocol === "tcp" || n.protocol === "udp" ? n.port : null) && x.from.map(normalizeCidrOrToken).join(",") === from,
  );
}

function normalizeCidrOrToken(s: string) {
  return s.startsWith("{") || s === "any" ? s : normalizeCidr(s);
}

function ForeignSwitch({ value, onChange }: { value: ForeignChoice; onChange: (c: ForeignChoice) => void }) {
  const { t } = useTranslation();
  const opts: ForeignChoice[] = ["keep", "adopt", "drop"];
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded px-2 py-1 transition-colors",
            value === o
              ? o === "drop"
                ? "bg-destructive text-white"
                : "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {t(`foreign.${o}`)}
        </button>
      ))}
    </div>
  );
}
