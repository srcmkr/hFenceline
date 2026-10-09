import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyText } from "@/platform/desktop";
import { useErrorToast } from "./errors";

const SHOW_MS = 1200;
const FADE_MS = 200;

type Phase = "idle" | "in" | "out";

/**
 * Kleiner Icon-Button, der `text` in die Zwischenablage kopiert und kurz "Kopiert" rechts daneben einblendet.
 * `compact` passt ihn in einen Chip mit px-1.5/py-0.5 ein, ohne dessen Höhe zu ändern.
 */
export function CopyButton({ text, compact, className }: { text: string; compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const copy = async () => {
    try {
      await copyText(text);
    } catch (e) {
      showError(e);
      return;
    }
    clearTimers();
    setPhase("in");
    timers.current = [setTimeout(() => setPhase("out"), SHOW_MS), setTimeout(() => setPhase("idle"), SHOW_MS + FADE_MS)];
  };

  return (
    <span className="relative inline-flex items-center">
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          void copy();
        }}
        aria-label={t("common.copy")}
        className={cn("text-muted-foreground hover:text-foreground", compact && "-my-0.5 -mr-1 size-5 hover:bg-foreground/10", className)}
      >
        {phase === "idle" ? <Copy /> : <Check className="text-emerald-600 dark:text-emerald-400" />}
      </Button>
      {phase !== "idle" && (
        <span
          role="status"
          className={cn(
            "pointer-events-none absolute top-1/2 left-full z-10 ml-1.5 -translate-y-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-sans text-[11px] leading-tight font-medium whitespace-nowrap text-background shadow-sm",
            phase === "in" ? "animate-in fade-in-0 slide-in-from-left-1 duration-150" : "animate-out fade-out-0 duration-200 fill-mode-forwards",
          )}
        >
          {t("common.copied")}
        </span>
      )}
    </span>
  );
}
