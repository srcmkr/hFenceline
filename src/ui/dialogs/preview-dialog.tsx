import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { FirewallKey } from "@/core/app/overview";
import type { Firewall } from "@/core/hetzner/types";
import type { PlanResult } from "@/core/plan/plan";
import { normalizeCidr } from "@/core/net/ip";
import { useService, useServiceState } from "../service-context";
import { PlanWarnings, RuleDiff } from "../preview";
import { errorText, useErrorToast } from "../errors";

export function PreviewDialog({ fwKey, open, onOpenChange }: { fwKey: FirewallKey; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const [data, setData] = useState<{ firewall: Firewall; plan: PlanResult } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [applying, setApplying] = useState(false);

  const view = state.overview?.firewalls.find((f) => f.key === fwKey);
  const notes = new Map((view?.config.static_ips ?? []).map((s) => [normalizeCidr(s.cidr), s.note]));

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    service.preview(fwKey).then(setData, setError);
  }, [open, fwKey, service]);

  async function apply() {
    setApplying(true);
    try {
      const r = await service.applyFirewall(fwKey);
      if (r.ok) {
        toast.success(t("apply.success", { name: r.name }), {
          description: r.unchanged ? t("apply.unchanged") : t("apply.summary", { added: r.added, removed: r.removed }),
        });
        onOpenChange(false);
      } else {
        toast.error(t("apply.failed", { name: r.name }), { description: r.error });
      }
    } catch (e) {
      showError(e);
    } finally {
      setApplying(false);
    }
  }

  const changes = data ? data.plan.added.length + data.plan.removed.length : 0;
  const err = error ? errorText(t, error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("preview.title", { name: view?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("preview.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {err && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err.title}
              {err.detail && <span className="block text-xs opacity-80">{err.detail}</span>}
            </p>
          )}
          {!data && !err && (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          )}
          {data && (
            <>
              <PlanWarnings warnings={data.plan.warnings} />
              <RuleDiff before={data.firewall.rules} after={data.plan.rules} ctx={{ homeIp: state.homeIp, notes }} />
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={apply} disabled={!data || applying} variant={data?.plan.warnings.includes("lockout") ? "destructive" : "default"}>
            {applying && <Loader2 className="size-4 animate-spin" />}
            {changes === 0 ? t("preview.confirmNoChanges") : t("preview.confirm", { count: changes })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
