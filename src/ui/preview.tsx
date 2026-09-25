import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ShieldAlert, TriangleAlert } from "lucide-react";
import type { FirewallRule } from "@/core/hetzner/types";
import type { PlanWarning } from "@/core/plan/plan";
import { diffRules, ruleKey } from "@/core/plan/rules";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RuleRow, type SourceContext } from "./rules";

export function PlanWarnings({ warnings }: { warnings: PlanWarning[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <Alert key={w} variant={w === "lockout" || w === "no-rules" ? "destructive" : "default"}>
          {w === "lockout" || w === "no-rules" ? <ShieldAlert /> : <TriangleAlert />}
          <AlertTitle>{t(`warnings.${w}.title`)}</AlertTitle>
          <AlertDescription>{t(`warnings.${w}.text`)}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

export function RuleDiff({ before, after, ctx }: { before: FirewallRule[]; after: FirewallRule[]; ctx: SourceContext }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { added, removed, unchanged } = useMemo(() => {
    const d = diffRules(before, after);
    const changed = new Set(d.added.map(ruleKey));
    return { ...d, unchanged: after.filter((r) => !changed.has(ruleKey(r))) };
  }, [before, after]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        {added.length === 0 && removed.length === 0 ? (
          <span>{t("preview.noChanges")}</span>
        ) : (
          <>
            <span className="text-emerald-700 dark:text-emerald-400">{t("preview.addedCount", { count: added.length })}</span>
            <span className="text-red-700 dark:text-red-400">{t("preview.removedCount", { count: removed.length })}</span>
          </>
        )}
      </div>
      <div className="divide-y divide-border/60">
        {added.map((r, i) => (
          <RuleRow key={`a${i}`} rule={r} ctx={ctx} change="added" />
        ))}
        {removed.map((r, i) => (
          <RuleRow key={`r${i}`} rule={r} ctx={ctx} change="removed" />
        ))}
      </div>
      {unchanged.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40">
            <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
            {t("preview.unchangedCount", { count: unchanged.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-border/60 border-t">
              {unchanged.map((r, i) => (
                <RuleRow key={`u${i}`} rule={r} ctx={ctx} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
