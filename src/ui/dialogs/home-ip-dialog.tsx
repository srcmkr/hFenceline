import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApplyResult } from "@/core/app/service";
import { useService, useServiceState } from "../service-context";
import { StatusDot } from "../status";
import { useErrorToast } from "../errors";

export function HomeIpDialog({
  open,
  onOpenChange,
  initialResults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialResults?: ApplyResult[] | null;
}) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const overview = state.overview!;
  const [results, setResults] = useState<ApplyResult[] | null>(initialResults ?? null);
  const [running, setRunning] = useState<string[] | "all" | null>(null);

  useEffect(() => {
    if (open) setResults(initialResults ?? null);
  }, [open, initialResults]);

  const targets = overview.homeIpTargets;
  const projectName = (key: string) => {
    const pk = key.split("/").slice(0, 2).join("/");
    const p = overview.projects.find((x) => x.key === pk);
    return p ? `${p.customer.name} · ${p.project.name}` : pk;
  };

  async function run(keys?: string[]) {
    setRunning(keys ?? "all");
    try {
      const r = await service.applyHomeIp(keys);
      setResults((prev) => {
        if (!keys || !prev) return r;
        const byKey = new Map(r.map((x) => [x.key, x]));
        return prev.map((x) => byKey.get(x.key) ?? x);
      });
    } catch (e) {
      showError(e);
    } finally {
      setRunning(null);
    }
  }

  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("homeip.dialogTitle")}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="font-mono text-muted-foreground line-through decoration-muted-foreground/40">
                {state.config?.homeip.last_applied ?? "-"}
              </span>
              <ArrowRight className="size-3.5" />
              <span className="font-mono font-medium text-foreground">{state.homeIp ?? "?"}</span>
              <span>· {t("homeip.targets", { count: targets.length })}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
          {targets.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("homeip.noTargets")}</p>}
          {targets.map((f) => {
            const r = results?.find((x) => x.key === f.key);
            const busy = running === "all" || (Array.isArray(running) && running.includes(f.key));
            return (
              <div key={f.key} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex size-5 items-center justify-center">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : r ? (
                    r.ok ? (
                      <Check className="size-4 text-emerald-600" />
                    ) : (
                      <X className="size-4 text-red-600" />
                    )
                  ) : (
                    <StatusDot state={f.state} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r && !r.ok ? <span className="text-red-600 dark:text-red-400">{r.error}</span> : projectName(f.key)}
                  </div>
                </div>
                {r?.ok && (
                  <span className="text-xs text-muted-foreground">
                    {r.unchanged ? t("homeip.unchanged") : t("homeip.updated")}
                  </span>
                )}
                {r && !r.ok && (
                  <Button size="sm" variant="outline" disabled={!!running} onClick={() => run([f.key])}>
                    <RotateCcw className="size-3.5" />
                    {t("common.retry")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          {results && failed.length === 0 ? (
            <Button onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
          ) : results ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
              <Button disabled={!!running} onClick={() => run(failed.map((f) => f.key))}>
                <RotateCcw className="size-4" />
                {t("homeip.retryFailed", { count: failed.length })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={!!running || !state.homeIp || targets.length === 0} onClick={() => run()}>
                {running && <Loader2 className="size-4 animate-spin" />}
                {t("homeip.apply")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
