import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Layers, Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Block, Template } from "@/core/model/config";
import { slugify } from "@/core/model/config";
import { plan } from "@/core/plan/plan";
import { finalizeBlockIds } from "@/core/model/template-edit";
import { useService, useServiceState } from "../service-context";
import { PageHeader } from "../section";
import { RuleSpecForm, SpecSummary } from "../editors";
import { StatusDot } from "../status";
import { useAction, useErrorToast } from "../errors";
import { useNav } from "../navigation";
import { ConfirmDialog } from "../dialogs/confirm-dialog";
import { HelpTip } from "../help-tip";

export function TemplatesPage({ templateId }: { templateId?: string }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const nav = useNav();
  const config = state.config!;
  const selectedId = templateId ?? config.templates[0]?.id;
  const original = config.templates.find((x) => x.id === selectedId);
  const [draft, setDraft] = useState<Template | null>(original ? structuredClone(original) : null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setDraft(original ? structuredClone(original) : null);
  }, [selectedId]);

  const usage = (id: string) => state.overview!.firewalls.filter((f) => f.config.template === id);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original);

  const [create] = useAction(async (from?: Template) => {
    const base: Template = from
      ? structuredClone(from)
      : { id: "", name: t("templates.newName"), blocks: [] };
    const name = from ? `${from.name} ${t("templates.copySuffix")}` : base.name;
    const id = slugify(name, config.templates.map((x) => x.id));
    await service.updateConfig((c) => void c.templates.push({ ...base, id, name }));
    nav.go({ kind: "templates", templateId: id });
  });
  const [remove] = useAction(async () => {
    await service.updateConfig((c) => void (c.templates = c.templates.filter((x) => x.id !== selectedId)));
    nav.go({ kind: "templates" });
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("templates.title")} />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-2">
          <div className="overflow-hidden rounded-xl border bg-card">
            {config.templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => nav.go({ kind: "templates", templateId: tpl.id })}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 transition-colors",
                  tpl.id === selectedId ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <Layers className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{tpl.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("templates.blocksCount", { count: tpl.blocks.length })} · {t("templates.usedBy", { count: usage(tpl.id).length })}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={() => void create()}>
            <Plus className="size-4" />
            {t("templates.new")}
          </Button>
        </div>

        {draft && original ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="tpl-name">{t("templates.name")}</Label>
                <Input id="tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <Button variant="ghost" onClick={() => void create(original)}>
                <Copy className="size-4" />
                {t("templates.duplicate")}
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={usage(original.id).length > 0 || config.templates.length <= 1}
                title={usage(original.id).length > 0 ? t("templates.inUse") : undefined}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                {t("common.delete")}
              </Button>
            </div>

            {draft.blocks.map((b, i) => (
              <BlockEditor
                key={b.id}
                block={b}
                onChange={(nb) => {
                  const blocks = [...draft.blocks];
                  blocks[i] = nb;
                  setDraft({ ...draft, blocks });
                }}
                onRemove={() => setDraft({ ...draft, blocks: draft.blocks.filter((_, j) => j !== i) })}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => {
                const name = t("templates.newBlock");
                const id = slugify(name, draft.blocks.map((x) => x.id));
                setDraft({ ...draft, blocks: [...draft.blocks, { id, name, rules: [] }] });
              }}
            >
              <Plus className="size-4" />
              {t("templates.addBlock")}
            </Button>

            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-3 backdrop-blur">
              {dirty && <span className="mr-auto text-xs text-muted-foreground">{t("templates.unsaved")}</span>}
              <Button variant="outline" disabled={!dirty} onClick={() => setDraft(structuredClone(original))}>
                {t("common.discard")}
              </Button>
              <Button disabled={!dirty || !draft.name.trim()} onClick={() => setSaveOpen(true)}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("templates.none")}</p>
        )}
      </div>

      {draft && saveOpen && <SaveTemplateDialog draft={draft} onOpenChange={setSaveOpen} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("templates.deleteTitle", { name: original?.name ?? "" })}
        description={t("templates.deleteText")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => remove()}
      />
    </div>
  );
}

export function BlockEditor({ block, onChange, onRemove }: { block: Block; onChange: (b: Block) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Input className="h-8 max-w-64 font-medium" value={block.name} onChange={(e) => onChange({ ...block, name: e.target.value })} />
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={t("templates.idHint")}>
          hfl:{block.id}
        </code>
        <span className="ml-auto flex items-center gap-1.5">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={!!block.optional}
              onCheckedChange={(v) => onChange(v ? { ...block, optional: true, default: block.default ?? false } : { ...block, optional: undefined, default: undefined })}
            />
            {t("templates.optional")}
          </label>
          <HelpTip title={t("templates.optionalHelp.title")} text={t("templates.optionalHelp.text")} />
        </span>
        {block.optional && (
          <span className="flex items-center gap-1.5">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={!!block.default} onCheckedChange={(v) => onChange({ ...block, default: v })} />
              {t("templates.defaultOn")}
            </label>
            <HelpTip title={t("templates.defaultOnHelp.title")} text={t("templates.defaultOnHelp.text")} />
          </span>
        )}
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={t("common.remove")}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="divide-y">
        {block.rules.map((r, i) =>
          editing === i ? (
            <div key={i} className="bg-muted/30 px-4 py-3">
              <RuleSpecForm
                initial={r}
                withName={false}
                allowStatic
                submitLabel={t("common.save")}
                onCancel={() => setEditing(null)}
                onSubmit={(edited) => {
                  const { name: _unused, ...spec } = edited;
                  void _unused;
                  onChange({ ...block, rules: block.rules.map((x, j) => (j === i ? spec : x)) });
                  setEditing(null);
                }}
              />
            </div>
          ) : (
            <div key={i} className="group flex items-center gap-3 px-4 py-2">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:bg-muted/60"
                onClick={() => {
                  setAdding(false);
                  setEditing(i);
                }}
              >
                <SpecSummary spec={r} />
                <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label={t("common.remove")}
                onClick={() => {
                  setEditing(null);
                  onChange({ ...block, rules: block.rules.filter((_, j) => j !== i) });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ),
        )}
        {block.rules.length === 0 && !adding && <p className="px-4 py-2 text-sm text-muted-foreground">{t("templates.noRules")}</p>}
      </div>
      {adding ? (
        <div className="border-t bg-muted/30 px-4 py-3">
          <RuleSpecForm
            withName={false}
            allowStatic
            submitLabel={t("common.add")}
            onCancel={() => setAdding(false)}
            onSubmit={(r) => {
              const { name: _unused, ...spec } = r;
              void _unused;
              onChange({ ...block, rules: [...block.rules, spec] });
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            <Plus className="size-4" />
            {t("templates.addRule")}
          </Button>
        </div>
      )}
    </div>
  );
}

function SaveTemplateDialog({ draft: rawDraft, onOpenChange }: { draft: Template; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const original = state.config!.templates.find((x) => x.id === rawDraft.id);
  const draft = useMemo(() => finalizeBlockIds(rawDraft, original), [rawDraft, original]);
  const showError = useErrorToast();
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);

  const affected = useMemo(
    () =>
      state.overview!.firewalls
        .filter((f) => f.config.template === draft.id)
        .map((f) => {
          const p = f.hetzner ? plan({ template: draft, firewall: f.config, actual: f.hetzner.rules, homeIp: state.homeIp }) : null;
          return { view: f, changes: p ? p.added.length + p.removed.length : null, lockout: !!p?.warnings.includes("lockout") };
        }),
    [draft, state.overview, state.homeIp],
  );

  async function save(apply: boolean) {
    setBusy(apply ? "apply" : "save");
    try {
      await service.updateConfig((c) => {
        const i = c.templates.findIndex((x) => x.id === draft.id);
        c.templates[i] = structuredClone(draft);
      });
      if (apply) {
        const results = [];
        for (const a of affected) results.push(await service.applyFirewall(a.view.key));
        const failed = results.filter((r) => !r.ok);
        if (failed.length) toast.error(t("templates.applyFailed", { count: failed.length }), { description: failed.map((f) => `${f.name}: ${f.error}`).join("\n") });
        else toast.success(t("templates.applied", { count: results.length }));
      } else toast.success(t("templates.saved"));
      onOpenChange(false);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates.saveTitle", { name: draft.name })}</DialogTitle>
          <DialogDescription>{t("templates.saveText", { count: affected.length })}</DialogDescription>
        </DialogHeader>
        {affected.length > 0 && (
          <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {affected.map(({ view, changes, lockout }) => (
              <div key={view.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <StatusDot state={view.state} />
                <span className="flex-1 truncate">{view.name}</span>
                {lockout && (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <ShieldAlert className="size-3.5" />
                    {t("warnings.lockout.title")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {changes === null ? t("templates.notLoaded") : t("templates.changes", { count: changes })}
                </span>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant={affected.length ? "secondary" : "default"} disabled={!!busy} onClick={() => save(false)}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />}
            {affected.length ? t("templates.saveOnly") : t("common.save")}
          </Button>
          {affected.length > 0 && (
            <Button disabled={!!busy} onClick={() => save(true)}>
              {busy === "apply" && <Loader2 className="size-4 animate-spin" />}
              {t("templates.saveAndApply", { count: affected.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
