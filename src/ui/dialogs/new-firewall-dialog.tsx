import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findTemplate } from "@/core/model/config";
import { normalizeCidr } from "@/core/net/ip";
import type { ProjectView } from "@/core/app/overview";
import { firewallKey } from "@/core/app/overview";
import { useService, useServiceState } from "../service-context";
import { BlockToggles, StaticIpEditor } from "../editors";
import type { ManageSettings } from "./manage-dialog";
import { PlanWarnings, RuleDiff } from "../preview";
import { useErrorToast } from "../errors";

export function NewFirewallDialog({
  project,
  open,
  onOpenChange,
  onCreated,
}: {
  project: ProjectView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (fwKey: string) => void;
}) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const config = state.config!;
  const [templateId, setTemplateId] = useState(config.templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [settings, setSettings] = useState<ManageSettings>({});
  const [busy, setBusy] = useState(false);

  const taken = new Set((project.data?.firewalls ?? []).map((f) => f.name));
  let suggested = `${project.project.id}-${templateId}`;
  for (let n = 2; taken.has(suggested); n++) suggested = `${project.project.id}-${templateId}-${n}`;
  useEffect(() => {
    if (open) {
      setSettings({});
      setNameTouched(false);
    }
  }, [open]);
  useEffect(() => {
    if (!nameTouched) setName(suggested);
  }, [suggested, nameTouched]);

  const template = findTemplate(config, templateId);
  const preview = useMemo(() => (template ? service.previewNew(templateId, settings) : null), [service, template, templateId, settings, state.homeIp]);
  const exists = (project.data?.firewalls ?? []).some((f) => f.name === name.trim());
  const notes = new Map((settings.static_ips ?? []).map((s) => [normalizeCidr(s.cidr), s.note]));

  async function create() {
    setBusy(true);
    try {
      const fw = await service.createFirewall({
        customerId: project.customer.id,
        projectId: project.project.id,
        name: name.trim(),
        templateId,
        settings,
      });
      toast.success(t("newFirewall.created", { name: fw.name }), { description: t("newFirewall.assignHint") });
      onOpenChange(false);
      onCreated?.(firewallKey(project.customer.id, project.project.id, fw.id));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("newFirewall.title")}</DialogTitle>
          <DialogDescription>{t("newFirewall.description", { project: project.project.name })}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fw-name">{t("newFirewall.name")}</Label>
                <Input
                  id="fw-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  aria-invalid={exists}
                />
                {exists && (
                  <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="size-3" />
                    {t("newFirewall.nameExists")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("manage.template")}</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
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
            </div>
            {template && (
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">{t("manage.blocks")}</div>
                <BlockToggles template={template} blocks={settings.blocks} onChange={(blocks) => setSettings({ ...settings, blocks })} />
              </div>
            )}
            <div className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">{t("staticIps.title")}</div>
              <StaticIpEditor value={settings.static_ips ?? []} onChange={(static_ips) => setSettings({ ...settings, static_ips })} />
            </div>
          </div>
          <div className="space-y-3">
            <Label>{t("manage.preview")}</Label>
            {preview && (
              <>
                <PlanWarnings warnings={preview.warnings} />
                <RuleDiff before={[]} after={preview.rules} ctx={{ homeIp: state.homeIp, notes }} />
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("newFirewall.labelHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={busy || !name.trim() || !template}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("newFirewall.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
