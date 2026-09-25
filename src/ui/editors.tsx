import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ExtraRule, Protocol, RuleSpec, StaticIp, Template } from "@/core/model/config";
import { PROTOCOLS, SOURCE_ANY, SOURCE_HOME, SOURCE_STATIC } from "@/core/model/config";
import { hasHostBits, isValidCidr4, normalizeCidr } from "@/core/net/ip";
import { ProtocolBadge } from "./rules";
import { FULL_PORT_RANGE } from "@/core/plan/rules";
import { HelpTip } from "./help-tip";

export function sourceLabel(t: TFunction, s: string): string {
  if (s === SOURCE_ANY) return t("rules.anywhere");
  if (s === SOURCE_HOME) return t("rules.home");
  if (s === SOURCE_STATIC) return t("rules.static");
  return s.endsWith("/32") ? s.slice(0, -3) : s;
}

export function SpecSummary({ spec }: { spec: RuleSpec }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <ProtocolBadge protocol={spec.protocol === "all" ? t("rules.fullAccess") : spec.protocol} />
      {(spec.protocol === "tcp" || spec.protocol === "udp") &&
        (spec.port && spec.port !== FULL_PORT_RANGE ? (
          <span className="font-mono">{spec.port}</span>
        ) : (
          <span className="text-muted-foreground">{t("rules.allPorts")}</span>
        ))}
      <span className="text-muted-foreground">{t("rules.from")}</span>
      {spec.from.map((f) => (
        <span
          key={f}
          className={cn(
            "rounded px-1.5 py-0.5",
            f === SOURCE_HOME
              ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
              : f === SOURCE_ANY
                ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : f === SOURCE_STATIC
                  ? "bg-teal-500/10 text-teal-700 dark:text-teal-300"
                  : "bg-muted font-mono",
          )}
        >
          {sourceLabel(t, f)}
        </span>
      ))}
    </span>
  );
}

export function BlockToggles({
  template,
  blocks,
  onChange,
  disabled,
}: {
  template: Template;
  blocks: Record<string, boolean> | undefined;
  onChange: (blocks: Record<string, boolean>) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="divide-y">
      {template.blocks.map((b) => {
        const on = b.optional ? (blocks?.[b.id] ?? b.default ?? false) : true;
        return (
          <div key={b.id} className={cn("flex items-start gap-3 px-4 py-3", !on && "opacity-60")}>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-sm font-medium">{b.name}</div>
              <div className="flex flex-col gap-1">
                {b.rules.map((r, i) => (
                  <SpecSummary key={i} spec={r} />
                ))}
              </div>
            </div>
            {b.optional ? (
              <Switch
                checked={on}
                disabled={disabled}
                aria-label={b.name}
                onCheckedChange={(v) => onChange({ ...(blocks ?? {}), [b.id]: v })}
              />
            ) : (
              <HelpTip title={t("blocks.alwaysOn")} text={t("blocks.alwaysOnHint")}>
                <span className="flex cursor-help items-center gap-1 pt-0.5 text-xs text-muted-foreground">
                  <Lock className="size-3" />
                  {t("blocks.alwaysOn")}
                </span>
              </HelpTip>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function cidrProblem(t: TFunction, value: string, existing: string[] = []): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!isValidCidr4(v)) return t("staticIps.invalid");
  if (hasHostBits(v)) return t("staticIps.hostBits", { network: normalizeCidr(v) });
  if (existing.includes(normalizeCidr(v))) return t("staticIps.duplicate");
  return null;
}

export function StaticIpEditor({
  value,
  onChange,
  disabled,
}: {
  value: StaticIp[];
  onChange: (next: StaticIp[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [cidr, setCidr] = useState("");
  const [note, setNote] = useState("");
  const problem = cidrProblem(t, cidr, value.map((v) => normalizeCidr(v.cidr)));

  function add() {
    if (!cidr.trim() || problem) return;
    const entry: StaticIp = { cidr: normalizeCidr(cidr) };
    if (note.trim()) entry.note = note.trim();
    onChange([...value, entry]);
    setCidr("");
    setNote("");
  }

  return (
    <div>
      {value.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{t("staticIps.empty")}</p>}
      <div className="divide-y">
        {value.map((s, i) => (
          <div key={s.cidr} className="flex items-center gap-3 px-4 py-2">
            <span className="w-40 shrink-0 font-mono text-sm">{s.cidr.endsWith("/32") ? s.cidr.slice(0, -3) : s.cidr}</span>
            <Input
              defaultValue={s.note ?? ""}
              placeholder={t("staticIps.notePlaceholder")}
              className="h-8 flex-1"
              disabled={disabled}
              onBlur={(e) => {
                const n = e.target.value.trim();
                if (n === (s.note ?? "")) return;
                const next = [...value];
                next[i] = n ? { cidr: s.cidr, note: n } : { cidr: s.cidr };
                onChange(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              aria-label={t("common.remove")}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <form
        className="flex items-start gap-3 border-t bg-muted/30 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="w-40 shrink-0 space-y-1">
          <Input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="198.51.100.10"
            className="h-8 font-mono"
            aria-invalid={!!problem}
            disabled={disabled}
          />
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("staticIps.notePlaceholder")}
          className="h-8 flex-1"
          disabled={disabled}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || !cidr.trim() || !!problem}>
          <Plus className="size-4" />
          {t("common.add")}
        </Button>
      </form>
    </div>
  );
}

export function parseSources(t: TFunction, text: string, allowStatic: boolean): { from: string[]; error: string | null } {
  const parts = text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) return { from: [], error: t("ruleEditor.sourcesRequired") };
  const out: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === "any" || lower === "überall" || lower === "anywhere") out.push(SOURCE_ANY);
    else if (lower === "{heim}" || lower === "{home}") out.push(SOURCE_HOME);
    else if (lower === "{fest}" || lower === "{static}") {
      if (!allowStatic) return { from: [], error: t("ruleEditor.noStaticHere") };
      out.push(SOURCE_STATIC);
    } else if (isValidCidr4(p)) {
      if (hasHostBits(p)) return { from: [], error: t("staticIps.hostBits", { network: normalizeCidr(p) }) };
      out.push(normalizeCidr(p));
    } else return { from: [], error: t("ruleEditor.invalidSource", { value: p }) };
  }
  return { from: [...new Set(out)], error: null };
}

function portProblem(t: TFunction, protocol: Protocol, port: string): string | null {
  if (protocol !== "tcp" && protocol !== "udp") return null;
  if (!port.trim()) return null;
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(port.trim());
  if (!m) return t("ruleEditor.invalidPort");
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (a < 1 || b > 65535 || a > b) return t("ruleEditor.invalidPort");
  return null;
}

export function RuleSpecForm({
  initial,
  withName,
  allowStatic,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ExtraRule>;
  withName: boolean;
  allowStatic: boolean;
  submitLabel: string;
  onSubmit: (rule: ExtraRule) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [protocol, setProtocol] = useState<Protocol>(initial?.protocol ?? "tcp");
  const [port, setPort] = useState(initial?.port ?? "");
  const [sources, setSources] = useState((initial?.from ?? []).join(", "));
  const [touched, setTouched] = useState(false);

  const parsed = parseSources(t, sources, allowStatic);
  const pp = portProblem(t, protocol, port);
  const nameMissing = withName && !name.trim();
  const valid = !parsed.error && !pp && !nameMissing;

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_8rem_7rem]"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        const rule: ExtraRule = { name: name.trim() || "-", protocol, from: parsed.from };
        if ((protocol === "tcp" || protocol === "udp") && port.trim()) rule.port = port.trim();
        onSubmit(rule);
      }}
    >
      {withName && (
        <div className="space-y-1.5 sm:col-span-3">
          <Label>{t("ruleEditor.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ruleEditor.namePlaceholder")} aria-invalid={touched && nameMissing} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t("ruleEditor.sources")}</Label>
        <Input
          value={sources}
          onChange={(e) => setSources(e.target.value)}
          placeholder={allowStatic ? "any, {heim}, {fest}, 192.0.2.5" : "any, {heim}, 192.0.2.5"}
          className="font-mono"
          aria-invalid={touched && !!parsed.error}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t("ruleEditor.protocol")}</Label>
        <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOLS.map((p) => (
              <SelectItem key={p} value={p}>
                {p === "all" ? t("rules.fullAccess") : p.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("ruleEditor.port")}</Label>
        <Input
          value={protocol === "tcp" || protocol === "udp" ? port : ""}
          onChange={(e) => setPort(e.target.value)}
          placeholder={protocol === "tcp" || protocol === "udp" ? t("rules.allPorts") : "-"}
          disabled={protocol !== "tcp" && protocol !== "udp"}
          className="font-mono"
          aria-invalid={touched && !!pp}
        />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        {touched && (parsed.error || pp || (nameMissing && t("ruleEditor.nameRequired"))) ? (
          <span className="text-destructive">{parsed.error || pp || t("ruleEditor.nameRequired")}</span>
        ) : (
          t(allowStatic ? "ruleEditor.sourcesHintStatic" : "ruleEditor.sourcesHint")
        )}
      </p>
      <div className="flex justify-end gap-2 sm:col-span-3">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ExtraRulesEditor({
  value,
  onChange,
  disabled,
}: {
  value: ExtraRule[];
  onChange: (next: ExtraRule[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div>
      {value.length === 0 && !adding && <p className="px-4 py-3 text-sm text-muted-foreground">{t("extraRules.empty")}</p>}
      <div className="divide-y">
        {value.map((r, i) =>
          editing === i ? (
            <div key={i} className="bg-muted/30 px-4 py-3">
              <RuleSpecForm
                initial={r}
                withName
                allowStatic
                submitLabel={t("common.save")}
                onCancel={() => setEditing(null)}
                onSubmit={(rule) => {
                  const next = [...value];
                  next[i] = rule;
                  onChange(next);
                  setEditing(null);
                }}
              />
            </div>
          ) : (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <button className="min-w-0 flex-1 space-y-1 text-left" disabled={disabled} onClick={() => setEditing(i)}>
                <div className="text-sm font-medium">{r.name}</div>
                <SpecSummary spec={r} />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                disabled={disabled}
                aria-label={t("common.remove")}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ),
        )}
      </div>
      {adding ? (
        <div className="border-t bg-muted/30 px-4 py-3">
          <RuleSpecForm
            withName
            allowStatic
            submitLabel={t("common.add")}
            onCancel={() => setAdding(false)}
            onSubmit={(rule) => {
              onChange([...value, rule]);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <div className="border-t px-4 py-2.5">
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("extraRules.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
