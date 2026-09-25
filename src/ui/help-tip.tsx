import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HelpTip({
  title,
  text,
  children,
  className,
}: {
  title: string;
  text: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children ?? (
          <button
            type="button"
            aria-label={title}
            className={cn("inline-flex text-muted-foreground transition-colors hover:text-foreground", className)}
          >
            <Info className="size-3.5" />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-72 space-y-1.5 p-3 text-left leading-relaxed">
        <div className="text-[13px] font-semibold">{title}</div>
        <p className="opacity-85">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
