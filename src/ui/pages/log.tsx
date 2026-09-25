import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleCheck, CircleX, FileClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/core/audit/audit";
import { useService, useServiceState } from "../service-context";
import { PageHeader } from "../section";
import { RuleDiff } from "../preview";

export function LogPage() {
  const { t, i18n } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    void service.auditEntries().then(setEntries);
  }, [service, state.data, state.config]);

  const projectName = (e: AuditEntry) => {
    const p = state.config?.customers.find((c) => c.id === e.customer)?.projects.find((x) => x.id === e.project);
    const c = state.config?.customers.find((x) => x.id === e.customer);
    return p && c ? `${c.name} · ${p.name}` : `${e.customer}/${e.project}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("log.title")} />
      {entries && entries.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          <FileClock className="size-8 opacity-50" />
          {t("log.empty")}
        </div>
      )}
      {entries && entries.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          {entries.map((e, i) => (
            <div key={i} className="border-b last:border-b-0">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="grid w-full grid-cols-[1rem_1.25rem_9.5rem_1fr_auto] items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
              >
                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open === i && "rotate-90")} />
                {e.result === "ok" ? <CircleCheck className="size-4 text-emerald-500" /> : <CircleX className="size-4 text-red-500" />}
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {new Date(e.time).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "medium" })}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{e.firewall_name}</span>
                  <span className="text-muted-foreground"> · {projectName(e)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{t(`log.action.${e.action}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`log.trigger.${e.trigger}`)}</span>
                </span>
              </button>
              {open === i && (
                <div className="space-y-3 border-t bg-muted/20 px-4 py-4">
                  {e.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{e.error}</p>}
                  {e.new_rules && <RuleDiff before={e.old_rules ?? []} after={e.new_rules} ctx={{ homeIp: null }} />}
                  {e.new_labels && (
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <Labels title={t("log.oldLabels")} labels={e.old_labels} />
                      <Labels title={t("log.newLabels")} labels={e.new_labels} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Labels({ title, labels }: { title: string; labels?: Record<string, string> }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1.5 font-medium">{title}</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(labels ?? {}).map(([k, v]) => (
          <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {k}={v}
          </span>
        ))}
        {Object.keys(labels ?? {}).length === 0 && <span className="text-muted-foreground">-</span>}
      </div>
    </div>
  );
}
