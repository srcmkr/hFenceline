import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronLeft, FileLock2, CircleCheck, CircleX, House, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Firewall } from "@/core/hetzner/types";
import type { Language, Template } from "@/core/model/config";
import { findTemplate, slugify } from "@/core/model/config";
import { finalizeBlockIds } from "@/core/model/template-edit";
import { plan, type PlanResult } from "@/core/plan/plan";
import { ruleKey } from "@/core/plan/rules";
import { projectKey, type ProjectView } from "@/core/app/overview";
import type { ApplyResult } from "@/core/app/service";
import { setLanguage, systemLanguage } from "@/i18n";
import { useService, useServiceState } from "./service-context";
import { ProjectForm } from "./dialogs/project-dialog";
import { ManagePanel, useManageDraft, type ManageDraft } from "./dialogs/manage-dialog";
import { NewFirewallDialog } from "./dialogs/new-firewall-dialog";
import { BlockEditor } from "./pages/templates";
import { PlanWarnings, RuleDiff } from "./preview";
import { Logo } from "./logo";
import { ImportBackupDialog } from "./dialogs/backup-dialog";
import { isDesktop } from "@/platform/desktop";
import { errorText, useErrorToast } from "./errors";

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: Step[] = [1, 2, 3, 4, 5];

export function Wizard({ startStep, onFinish, onCancel }: { startStep: 1 | 3; onFinish: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const [step, setStep] = useState<Step>(startStep);
  const [projects, setProjects] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { projectKey: string; firewall: Firewall; draft: ManageDraft } | null>>({});
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  const visibleSteps = STEPS.filter((s) => s >= startStep);
  const chosen = Object.values(drafts).filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-6">
        <Logo className="size-7" />
        <div className="text-[15px] font-semibold tracking-tight">hFenceline</div>
        <ol className="ml-8 hidden items-center gap-1 md:flex">
          {visibleSteps.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1 h-px w-6 bg-border" />}
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                  s < step ? "bg-primary text-primary-foreground" : s === step ? "bg-primary/10 text-primary ring-1 ring-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {s < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("text-xs", s === step ? "font-medium" : "text-muted-foreground")}>{t(`wizard.step${s}.short`)}</span>
            </li>
          ))}
        </ol>
        {onCancel && (
          <Button variant="ghost" className="ml-auto" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-semibold tracking-tight">{t(`wizard.step${step}.title`)}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t(`wizard.step${step}.text`)}</p>
            </div>
            {step > startStep && !results && (
              <Button variant="ghost" onClick={() => setStep((step - 1) as Step)}>
                <ChevronLeft className="size-4" />
                {t("common.back")}
              </Button>
            )}
          </div>

          {step === 1 && <StepLanguage onNext={() => setStep(2)} onRestored={onFinish} />}
          {step === 2 && <StepTemplate onNext={() => setStep(3)} />}
          {step === 3 && (
            <StepProjects
              projects={projects}
              onAdded={(key) => setProjects((p) => [...p, key])}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <StepFirewalls
              projects={projects}
              drafts={drafts}
              setDraft={(fwKey, d) => setDrafts((x) => ({ ...x, [fwKey]: d }))}
              onNext={() => setStep(5)}
            />
          )}
          {step === 5 && (
            <StepApply
              chosen={chosen}
              results={results}
              onApply={async () => {
                const out: ApplyResult[] = [];
                for (const c of chosen) {
                  const [customerId, projectId] = c.projectKey.split("/") as [string, string];
                  const key = await service.manageFirewall({
                    customerId,
                    projectId,
                    firewall: c.firewall,
                    templateId: c.draft.templateId,
                    assignment: { ...c.draft.assignment, settings: c.draft.settings },
                  });
                  out.push(await service.applyFirewall(key, "import"));
                }
                if (state.homeIp && out.every((r) => r.ok)) {
                  await service.updateConfig((c) => void (c.homeip.last_applied = state.homeIp!));
                }
                setResults(out);
              }}
              onRetry={async (key) => {
                const r = await service.applyFirewall(key, "import");
                setResults((prev) => prev?.map((x) => (x.key === key ? r : x)) ?? null);
              }}
              onFinish={onFinish}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function StepLanguage({ onNext, onRestored }: { onNext: () => void; onRestored: () => void }) {
  const [importOpen, setImportOpen] = useState(false);
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const [lang, setLang] = useState<Language>(state.config?.language ?? systemLanguage());
  const [busy, setBusy] = useState(false);

  useEffect(() => setLanguage(lang), [lang]);

  async function next() {
    setBusy(true);
    try {
      if (!state.config) await service.initConfig(lang);
      else await service.updateConfig((c) => void (c.language = lang));
      onNext();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["de", "en"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cn(
              "rounded-xl border bg-card p-5 text-left transition-all",
              lang === l ? "border-primary ring-2 ring-primary/20" : "hover:border-foreground/20",
            )}
          >
            <div className="text-lg font-semibold">{l === "de" ? "Deutsch" : "English"}</div>
            <div className="text-sm text-muted-foreground">{l === "de" ? "Oberfläche auf Deutsch" : "Interface in English"}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 rounded-xl border bg-card p-5">
        <div className="flex size-10 items-center justify-center rounded-full bg-violet-500/10 text-violet-600">
          <House className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t("wizard.step1.homeIp")}</div>
          <div className="font-mono text-xl font-semibold">
            {state.homeIpLoading ? <Loader2 className="size-5 animate-spin" /> : (state.homeIp ?? "-")}
          </div>
          {state.homeIpError && <div className="text-xs text-destructive">{state.homeIpError}</div>}
        </div>
        <Button variant="outline" size="sm" onClick={() => void service.refreshHomeIp()}>
          <RotateCcw className="size-3.5" />
          {t("wizard.step1.recheck")}
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2">
        {isDesktop && (
          <Button size="lg" variant="ghost" className="mr-auto" onClick={() => setImportOpen(true)}>
            <FileLock2 className="size-4" />
            {t("backup.fromBackup")}
          </Button>
        )}
        <Button size="lg" onClick={next} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("common.next")}
        </Button>
      </div>
      <ImportBackupDialog open={importOpen} onOpenChange={setImportOpen} onDone={onRestored} />
    </div>
  );
}

function StepTemplate({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const original = state.config!.templates[0]!;
  const [draft, setDraft] = useState<Template>(() => structuredClone(original));

  async function next() {
    try {
      if (JSON.stringify(draft) !== JSON.stringify(original)) {
        const final = finalizeBlockIds(draft, original);
        await service.updateConfig((c) => void (c.templates[0] = final));
      }
      onNext();
    } catch (e) {
      showError(e);
    }
  }

  return (
    <div className="space-y-4">
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
      <p className="text-xs text-muted-foreground">{t("wizard.step2.later")}</p>
      <div className="flex justify-end">
        <Button size="lg" onClick={next}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

function StepProjects({ projects, onAdded, onNext }: { projects: string[]; onAdded: (key: string) => void; onNext: () => void }) {
  const { t } = useTranslation();
  const state = useServiceState();
  const [formKey, setFormKey] = useState(0);
  const views = state.overview?.projects.filter((p) => projects.includes(p.key)) ?? [];

  return (
    <div className="space-y-6">
      {views.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          {views.map((p) => (
            <div key={p.key} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <CircleCheck className="size-4 text-emerald-500" />
              <span className="text-sm font-medium">
                {p.customer.name} · {p.project.name}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {p.data?.loading ? t("common.loading") : t("project.firewallsCount", { count: p.data?.firewalls.length ?? 0 })}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">{views.length ? t("wizard.step3.another") : t("wizard.step3.first")}</h2>
        <ProjectForm
          key={formKey}
          submitLabel={t("project.add")}
          onDone={({ customerId, projectId }) => {
            onAdded(projectKey(customerId, projectId));
            setFormKey((k) => k + 1);
          }}
        />
      </div>
      <div className="flex justify-end">
        <Button size="lg" onClick={onNext} disabled={projects.length === 0}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

function StepFirewalls({
  projects,
  drafts,
  setDraft,
  onNext,
}: {
  projects: string[];
  drafts: Record<string, unknown>;
  setDraft: (fwKey: string, d: { projectKey: string; firewall: Firewall; draft: ManageDraft } | null) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const state = useServiceState();
  const views = state.overview?.projects.filter((p) => projects.includes(p.key)) ?? [];
  const loading = views.some((p) => p.data?.loading);

  return (
    <div className="space-y-6">
      {views.map((p) => (
        <ProjectFirewalls key={p.key} view={p} setDraft={setDraft} />
      ))}
      <div className="flex justify-end">
        <Button size="lg" onClick={onNext} disabled={loading}>
          {t("wizard.step4.toPreview", { count: Object.values(drafts).filter(Boolean).length })}
        </Button>
      </div>
    </div>
  );
}

function ProjectFirewalls({
  view,
  setDraft,
}: {
  view: ProjectView;
  setDraft: (fwKey: string, d: { projectKey: string; firewall: Firewall; draft: ManageDraft } | null) => void;
}) {
  const { t } = useTranslation();
  const [newOpen, setNewOpen] = useState(false);
  const d = view.data;
  const err = d?.error ? errorText(t, d.error) : null;
  const candidates = view.unmanaged;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <div className="text-sm font-semibold">
          {view.customer.name} · {view.project.name}
        </div>
        {d?.loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setNewOpen(true)} disabled={!d?.loadedAt || !!d.error}>
          <Plus className="size-3.5" />
          {t("project.newFirewall")}
        </Button>
      </header>
      {err && <p className="px-4 py-3 text-sm text-destructive">{err.title}: {err.detail}</p>}
      {d?.loadedAt && !d.error && candidates.length === 0 && (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          {view.firewalls.length > 0 ? t("wizard.step4.allManaged") : t("wizard.step4.noFirewalls")}
        </p>
      )}
      <div className="divide-y">
        {candidates.map((fw) => (
          <WizardFirewall key={fw.id} projectKey={view.key} firewall={fw} onChange={(dr) => setDraft(`${view.key}/${fw.id}`, dr)} />
        ))}
      </div>
      <NewFirewallDialog project={view} open={newOpen} onOpenChange={setNewOpen} />
    </section>
  );
}

function WizardFirewall({
  projectKey: pk,
  firewall,
  onChange,
}: {
  projectKey: string;
  firewall: Firewall;
  onChange: (d: { projectKey: string; firewall: Firewall; draft: ManageDraft } | null) => void;
}) {
  const { t } = useTranslation();
  const state = useServiceState();
  const { draft, setTemplateId, setHomeSource, setSettings } = useManageDraft(firewall);
  const [managed, setManaged] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onChange(managed && draft ? { projectKey: pk, firewall, draft } : null);
  }, [managed, draft?.templateId, draft?.settings, draft?.assignment]);

  const summary = draft?.assignment;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{firewall.name}</div>
          {summary && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("wizard.step4.summary", {
                covered: summary.covered.length,
                foreign: summary.foreign.length,
                static: summary.settings.static_ips?.length ?? 0,
              })}
              {!summary.homeCandidate && draft?.homeSource === undefined && summary.fullAccessHosts.length > 0 && (
                <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">· {t("wizard.step4.homeUnclear")}</span>
              )}
              {summary.homeCandidate && (
                <span className="ml-1 text-violet-600 dark:text-violet-400">
                  · {t("wizard.step4.homeFound", { ip: summary.homeCandidate.cidr.slice(0, -3) })}
                  {!summary.homeCandidate.confident && ` (${t("manage.probablyOldHome")})`}
                </span>
              )}
            </div>
          )}
        </div>
        <Select
          value={managed ? (draft?.templateId ?? "") : "__none__"}
          onValueChange={(v) => {
            if (v === "__none__") setManaged(false);
            else {
              setManaged(true);
              setTemplateId(v);
            }
          }}
        >
          <SelectTrigger size="sm" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {state.config!.templates.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>
                {t("wizard.step4.manageWith", { name: tpl.name })}
              </SelectItem>
            ))}
            <SelectItem value="__none__">{t("wizard.step4.dontManage")}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" disabled={!managed} onClick={() => setOpen(!open)}>
          {t("wizard.step4.details")}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open && managed && draft && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <ManagePanel firewall={firewall} draft={draft} setTemplateId={setTemplateId} setHomeSource={setHomeSource} setSettings={setSettings} />
        </div>
      )}
    </div>
  );
}

function StepApply({
  chosen,
  results,
  onApply,
  onRetry,
  onFinish,
}: {
  chosen: { projectKey: string; firewall: Firewall; draft: ManageDraft }[];
  results: ApplyResult[] | null;
  onApply: () => Promise<void>;
  onRetry: (key: string) => Promise<void>;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const state = useServiceState();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const plans = useMemo(
    () =>
      chosen.map((c) => {
        const template = findTemplate(state.config!, c.draft.templateId)!;
        const p: PlanResult = plan({
          template,
          firewall: { hetzner_id: c.firewall.id, template: template.id, ...c.draft.settings },
          actual: c.firewall.rules,
          homeIp: state.homeIp,
          dropForeign: new Set(c.draft.assignment.covered.map(ruleKey)),
        });
        return { ...c, plan: p, key: `${c.projectKey}/${c.firewall.id}` };
      }),
    [chosen, state.config, state.homeIp],
  );

  async function apply() {
    setBusy(true);
    try {
      await onApply();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {plans.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{t("wizard.step5.nothing")}</p>}
      <div className="space-y-3">
        {plans.map((p) => {
          const r = results?.find((x) => x.key === p.key);
          const changes = p.plan.added.length + p.plan.removed.length;
          return (
            <div key={p.key} className="overflow-hidden rounded-xl border bg-card">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === p.key ? null : p.key)}>
                {r ? r.ok ? <CircleCheck className="size-4 text-emerald-500" /> : <CircleX className="size-4 text-red-500" /> : <ChevronDown className={cn("size-4 transition-transform", open === p.key && "rotate-180")} />}
                <span className="flex-1 text-sm font-medium">{p.firewall.name}</span>
                {r && !r.ok && <span className="truncate text-xs text-destructive">{r.error}</span>}
                <span className="text-xs text-muted-foreground">{t("templates.changes", { count: changes })}</span>
                {r && !r.ok && (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void onRetry(p.key); }}>
                    <RotateCcw className="size-3.5" />
                    {t("common.retry")}
                  </Button>
                )}
              </button>
              {(p.plan.warnings.length > 0 || open === p.key) && (
                <div className="space-y-3 border-t px-4 py-4">
                  <PlanWarnings warnings={p.plan.warnings} />
                  {open === p.key && <RuleDiff before={p.firewall.rules} after={p.plan.rules} ctx={{ homeIp: state.homeIp }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {results ? (
          <Button size="lg" onClick={onFinish}>
            {t("wizard.finish")}
          </Button>
        ) : (
          <>
            <Button size="lg" variant="outline" onClick={onFinish}>
              {plans.length ? t("wizard.step5.skip") : t("wizard.finish")}
            </Button>
            {plans.length > 0 && (
              <Button size="lg" onClick={apply} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t("wizard.step5.apply", { count: plans.length })}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
