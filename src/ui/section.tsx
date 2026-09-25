import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <header className="flex items-start gap-3 border-b px-4 py-3">
        {icon && <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, badges, actions }: { title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        {subtitle && <div className="mb-1 text-xs font-medium text-muted-foreground">{subtitle}</div>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
