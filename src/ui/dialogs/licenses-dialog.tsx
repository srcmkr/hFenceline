import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface LicenseData {
  own: string;
  packages: { source: "npm" | "cargo"; name: string; version: string; license: string; repository: string | null; texts: string[] }[];
  texts: Record<string, string>;
}

export function LicensesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<LicenseData | null | "missing">(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    fetch("/licenses.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData, () => setData("missing"));
  }, [open, data]);

  const list = useMemo(() => {
    if (!data || data === "missing") return [];
    const q = query.trim().toLowerCase();
    return q ? data.packages.filter((p) => `${p.name} ${p.license}`.toLowerCase().includes(q)) : data.packages;
  }, [data, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("licenses.title")}</DialogTitle>
          <DialogDescription>{t("licenses.own")}</DialogDescription>
        </DialogHeader>
        {data === "missing" && <p className="text-sm text-muted-foreground">{t("licenses.missing")}</p>}
        {data && data !== "missing" && (
          <div className="space-y-3">
            <pre className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{data.own}</pre>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {t("licenses.thirdParty")} ({data.packages.length})
              </span>
              <Input className="ml-auto h-8 w-56" placeholder={t("licenses.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="max-h-[45vh] divide-y overflow-y-auto rounded-lg border">
              {list.map((p) => {
                const key = `${p.source}:${p.name}@${p.version}`;
                const isOpen = expanded === key;
                return (
                  <div key={key}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : key)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                    >
                      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.version}</span>
                      <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{p.license}</span>
                      <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground">{p.source}</span>
                    </button>
                    {isOpen && (
                      <div className="space-y-2 bg-muted/20 px-3 py-2">
                        {p.repository && <div className="truncate text-xs text-muted-foreground">{p.repository}</div>}
                        {p.texts.map((id) => (
                          <pre key={id} className="max-h-64 overflow-y-auto text-[11px] leading-relaxed whitespace-pre-wrap">
                            {data.texts[id]}
                          </pre>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("licenses.system")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
