import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { House, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Firewall } from "@/core/hetzner/types";
import type { ManagedFirewall } from "@/core/model/config";
import { findTemplate } from "@/core/model/config";
import type { AssignResult } from "@/core/plan/assign";
import { plan } from "@/core/plan/plan";
import { ruleKey } from "@/core/plan/rules";
import { normalizeCidr } from "@/core/net/ip";
import { useService, useServiceState } from "../service-context";
import { BlockToggles, StaticIpEditor } from "../editors";
import { PlanWarnings, RuleDiff } from "../preview";
import { RuleList } from "../rules";
import { useErrorToast } from "../errors";

export type ManageSettings = Pick<ManagedFirewall, "blocks" | "static_ips" | "extra_rules">;

export interface ManageDraft {
  templateId: string;
  homeSource: string | null | undefined;
  assignment: AssignResult;
  settings: ManageSettings;
}

export function useManageDraft(firewall: Firewall) {
  const service = useService();
  const state = useServiceState();
  const config = state.config!;
  const [templateId, setTemplateId] = useState(config.templates[0]?.id ?? "");
  const [homeSource, setHomeSource] = useState<string | null | undefined>(undefined);
  const assignment = useMemo(
    () => (templateId ? service.suggest(templateId, firewall, homeSource) : null),
    [templateId, homeSource, firewall, state.homeIp, config],
  );
  const [settings, setSettings] = useState<ManageSettings>(assignment?.settings ?? {});
  useEffect(() => setSettings(assignment?.settings ?? {}), [assignment]);
  const draft: ManageDraft | null = assignment ? { templateId, homeSource, assignment, settings } : null;
  return { draft, setTemplateId, setHomeSource, setSettings };
}

export function ManagePanel({
  firewall,
  draft,
  setTemplateId,
  setHomeSource,
  setSettings,
}: {
  firewall: Firewall;
  draft: ManageDraft;
  setTemplateId: (id: string) => void;
  setHomeSource: (s: string | null) => void;
  setSettings: (s: ManageSettings) => void;
}) {
  const { t } = useTranslation();
  const state = useServiceState();
  const config = state.config!;
  const template = findTemplate(config, draft.templateId)!;
  const { assignment, settings } = draft;
  const homeValue = assignment.homeCandidate?.cidr ?? "none";

  const result = useMemo(
    () =>
      plan({
        template,
        firewall: { hetzner_id: firewall.id, template: template.id, ...settings },
        actual: firewall.rules,
        homeIp: state.homeIp,
        dropForeign: new Set(assignment.covered.map(ruleKey)),
      }),
    [template, firewall, settings, state.homeIp, assignment],
  );
  const notes = new Map((settings.static_ips ?? []).map((s) => [normalizeCidr(s.cidr), s.note]));
  const ctx = { homeIp: state.homeIp, notes };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>{t("manage.template")}</Label>
          <Select value={draft.templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="w-full">
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
        </div>

        {assignment.fullAccessHosts.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <House className="size-3.5" />
              {t("manage.homeQuestion")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("manage.homeHint", { ip: state.homeIp ?? "?" })}</p>
            {!assignment.homeCandidate && draft.homeSource === undefined && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{t("manage.homeUnclear")}</p>
            )}
            <RadioGroup value={homeValue} onValueChange={(v) => setHomeSource(v === "none" ? null : v)} className="gap-1.5">
              {assignment.fullAccessHosts.map((h) => (
                <label key={h} className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/[0.03]">
                  <RadioGroupItem value={h} />
                  <span className="font-mono">{h.slice(0, -3)}</span>
                  {assignment.homeCandidate?.cidr === h && !assignment.homeCandidate.confident && draft.homeSource === undefined && (
                    <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">{t("manage.probablyOldHome")}</span>
                  )}
                  {state.homeIp && h === `${state.homeIp}/32` && <span className="ml-auto text-xs text-emerald-600">{t("manage.currentHome")}</span>}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-primary/50">
                <RadioGroupItem value="none" />
                {t("manage.noHome")}
              </label>
            </RadioGroup>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">{t("manage.blocks")}</div>
          <BlockToggles template={template} blocks={settings.blocks} onChange={(blocks) => setSettings({ ...settings, blocks })} />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">{t("staticIps.title")}</div>
          <StaticIpEditor value={settings.static_ips ?? []} onChange={(static_ips) => setSettings({ ...settings, static_ips })} />
        </div>
        {assignment.foreign.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">
              {t("manage.foreign", { count: assignment.foreign.length })}
            </div>
            <RuleList rules={assignment.foreign} ctx={ctx} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Label>{t("manage.preview")}</Label>
        <PlanWarnings warnings={result.warnings} />
        <RuleDiff before={firewall.rules} after={result.rules} ctx={ctx} />
      </div>
    </div>
  );
}

export function ManageDialog({
  projectKey,
  firewall,
  open,
  onOpenChange,
  onDone,
}: {
  projectKey: string;
  firewall: Firewall;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (fwKey: string) => void;
}) {
  const { t } = useTranslation();
  const service = useService();
  const showError = useErrorToast();
  const { draft, ...setters } = useManageDraft(firewall);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [customerId, projectId] = projectKey.split("/") as [string, string];

  async function submit(apply: boolean) {
    if (!draft) return;
    setBusy(apply ? "apply" : "save");
    try {
      const key = await service.manageFirewall({
        customerId,
        projectId,
        firewall,
        templateId: draft.templateId,
        assignment: { ...draft.assignment, settings: draft.settings },
      });
      if (apply) {
        const r = await service.applyFirewall(key, "import");
        if (r.ok) toast.success(t("apply.success", { name: r.name }), { description: t("apply.summary", { added: r.added, removed: r.removed }) });
        else toast.error(t("apply.failed", { name: r.name }), { description: r.error });
      } else {
        toast.success(t("manage.saved", { name: firewall.name }));
      }
      onOpenChange(false);
      onDone?.(key);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("manage.title", { name: firewall.name })}</DialogTitle>
          <DialogDescription>{t("manage.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {draft ? <ManagePanel firewall={firewall} draft={draft} {...setters} /> : <p className="text-sm">{t("manage.noTemplate")}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" disabled={!draft || !!busy} onClick={() => submit(false)}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />}
            {t("manage.saveOnly")}
          </Button>
          <Button disabled={!draft || !!busy} onClick={() => submit(true)}>
            {busy === "apply" && <Loader2 className="size-4 animate-spin" />}
            {t("manage.saveAndApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
