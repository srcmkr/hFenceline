import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TokenCheck } from "@/core/hetzner/client";
import { SecretStoreError } from "@/core/ports";
import { useService, useServiceState } from "../service-context";
import { errorText, useErrorToast } from "../errors";
import { ConfirmDialog } from "./confirm-dialog";

const NEW = "__new__";

export function TokenStatus({ check }: { check: TokenCheck | null }) {
  const { t } = useTranslation();
  if (!check) return null;
  if (check.valid && check.writable)
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-4" />
        {t("token.ok")}
      </p>
    );
  if (check.valid)
    return (
      <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
        <TriangleAlert className="size-4" />
        {t("token.readOnly")}
      </p>
    );
  const err = check.error ? errorText(t, check.error) : null;
  return (
    <p className="flex items-start gap-1.5 text-sm text-destructive">
      <CircleX className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("token.invalid")}
        {err?.detail && <span className="block text-xs opacity-80">{err.detail}</span>}
      </span>
    </p>
  );
}

export function useTokenSave() {
  const [pending, setPending] = useState<null | { confirm: () => void; cancel: () => void }>(null);
  const showError = useErrorToast();
  async function save(fn: (allowFile: boolean) => Promise<void>): Promise<boolean> {
    try {
      await fn(false);
      return true;
    } catch (e) {
      if (!(e instanceof SecretStoreError && e.code === "no-keyring")) {
        showError(e);
        return false;
      }
      return new Promise<boolean>((resolve) => {
        setPending({
          cancel: () => {
            setPending(null);
            resolve(false);
          },
          confirm: () => {
            setPending(null);
            fn(true).then(
              () => resolve(true),
              (e2) => {
                showError(e2);
                resolve(false);
              },
            );
          },
        });
      });
    }
  }
  const dialog = pending ? <FileFallbackDialog onConfirm={pending.confirm} onCancel={pending.cancel} /> : null;
  return { save, dialog };
}

export function FileFallbackDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title={t("token.noKeyringTitle")}
      description={t("token.noKeyringText")}
      confirmLabel={t("token.useFile")}
      onConfirm={onConfirm}
    />
  );
}

export function ProjectForm({ onDone, submitLabel }: { onDone: (ids: { customerId: string; projectId: string }) => void; submitLabel: string }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const customers = state.config?.customers ?? [];
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? NEW);
  const [customerName, setCustomerName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [token, setToken] = useState("");
  const [consoleId, setConsoleId] = useState("");
  const [check, setCheck] = useState<TokenCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const { save, dialog } = useTokenSave();

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await service.checkToken(token));
    } finally {
      setChecking(false);
    }
  }

  const needsCustomerName = customerId === NEW && !customerName.trim();
  const canSubmit = !!projectName.trim() && !!token.trim() && !needsCustomerName && !!check?.valid;

  async function submit() {
    setSaving(true);
    let ids: { customerId: string; projectId: string } | null = null;
    const ok = await save(async (allowFile) => {
      ids = await service.addProject(
        {
          customerId: customerId === NEW ? undefined : customerId,
          customerName: customerId === NEW ? customerName : undefined,
          projectName,
          token,
          consoleProjectId: /^\d+$/.test(consoleId.trim()) ? Number(consoleId.trim()) : undefined,
        },
        { allowFile },
      );
    });
    setSaving(false);
    if (ok && ids) {
      const { customerId: c, projectId: p } = ids;
      void service.refreshProject(c, p);
      onDone(ids);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("project.customer")}</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW}>{t("project.newCustomer")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {customerId === NEW && (
          <div className="space-y-2">
            <Label htmlFor="customer-name">{t("project.customerName")}</Label>
            <Input id="customer-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t("project.customerPlaceholder")} />
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="project-name">{t("project.name")}</Label>
          <Input id="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={t("project.namePlaceholder")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="console-id">{t("project.consoleId")}</Label>
          <Input id="console-id" value={consoleId} onChange={(e) => setConsoleId(e.target.value)} placeholder="1234567" inputMode="numeric" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="token">{t("token.label")}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="token"
              type="password"
              autoComplete="off"
              className="pl-8 font-mono"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setCheck(null);
              }}
            />
          </div>
          <Button type="button" variant="secondary" disabled={!token.trim() || checking} onClick={runCheck}>
            {checking && <Loader2 className="size-4 animate-spin" />}
            {t("token.check")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("token.hint")}</p>
        <TokenStatus check={check} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
      {dialog}
    </form>
  );
}

export function TokenDialog({
  customerId,
  projectId,
  open,
  onOpenChange,
}: {
  customerId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const service = useService();
  const [token, setToken] = useState("");
  const [check, setCheck] = useState<TokenCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const { save, dialog } = useTokenSave();

  async function submit() {
    setBusy(true);
    const c = await service.checkToken(token);
    setCheck(c);
    if (c.valid) {
      const ok = await save((allowFile) => service.setToken(customerId, projectId, token, { allowFile }));
      if (ok) {
        setToken("");
        onOpenChange(false);
      }
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("token.changeTitle")}</DialogTitle>
          <DialogDescription>{t("token.changeDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-token">{t("token.label")}</Label>
          <Input id="new-token" type="password" autoComplete="off" className="font-mono" value={token} onChange={(e) => setToken(e.target.value)} />
          <TokenStatus check={check} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!token.trim() || busy} onClick={submit}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("token.checkAndSave")}
          </Button>
        </DialogFooter>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
