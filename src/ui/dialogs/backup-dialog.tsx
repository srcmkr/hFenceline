import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileLock2, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readBackup, type BackupSummary } from "@/core/backup";
import { APP_VERSION } from "@/platform/links";
import { pickBackupOpenPath, pickBackupSavePath, readBackupFile, writeBackupFile } from "@/platform/desktop";
import { useService, useServiceState } from "../service-context";
import { useErrorToast } from "../errors";
import { useTokenSave } from "./project-dialog";

const MIN_LENGTH = 12;

export function ExportBackupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const service = useService();
  const showError = useErrorToast();
  const [pass, setPass] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPass("");
      setRepeat("");
    }
  }, [open]);

  const tooShort = pass.length > 0 && pass.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && pass !== repeat;
  const valid = pass.length >= MIN_LENGTH && pass === repeat;

  async function save() {
    const date = new Date().toISOString().slice(0, 10);
    const path = await pickBackupSavePath(`hfenceline-backup-${date}.age`);
    if (!path) return;
    setBusy(true);
    try {
      await writeBackupFile(path, pass, await service.createBackup(APP_VERSION));
      toast.success(t("backup.saved"), { description: path });
      onOpenChange(false);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("backup.exportTitle")}</DialogTitle>
          <DialogDescription>{t("backup.exportText")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bk-pass">{t("backup.passphrase")}</Label>
            <Input id="bk-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={tooShort} />
            {tooShort && <p className="text-xs text-destructive">{t("backup.tooShort")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-repeat">{t("backup.passphraseRepeat")}</Label>
            <Input id="bk-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-destructive">{t("backup.mismatch")}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || busy} onClick={save}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("backup.saveAs")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportBackupDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const showError = useErrorToast();
  const { save, dialog } = useTokenSave();
  const [path, setPath] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [loaded, setLoaded] = useState<{ json: string; summary: BackupSummary } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPath(null);
      setPass("");
      setLoaded(null);
      setProblem(null);
    }
  }, [open]);

  async function choose() {
    const p = await pickBackupOpenPath();
    if (p) {
      setPath(p);
      setLoaded(null);
      setProblem(null);
    }
  }

  async function decrypt() {
    if (!path) return;
    setBusy(true);
    setProblem(null);
    try {
      const json = await readBackupFile(path, pass);
      setLoaded({ json, summary: readBackup(json).summary });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("wrong-passphrase")) setProblem(t("backup.wrongPassphrase"));
      else if (msg.includes("invalid-file") || (e as Error)?.name === "BackupError") setProblem(t("backup.invalidFile"));
      else showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!loaded) return;
    setBusy(true);
    const ok = await save((allowFile) => service.restoreBackup(loaded.json, { allowFile }));
    setBusy(false);
    if (ok) {
      toast.success(t("backup.restored"));
      onOpenChange(false);
      onDone?.();
    }
  }

  const s = loaded?.summary;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("backup.importTitle")}</DialogTitle>
          <DialogDescription>{t("backup.hint")}</DialogDescription>
        </DialogHeader>
        {!loaded ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={choose}>
                <FileLock2 className="size-4" />
                {t("backup.chooseFile")}
              </Button>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={path ?? ""}>
                {path?.split(/[\\/]/).pop()}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-in-pass">{t("backup.passphrase")}</Label>
              <Input
                id="bk-in-pass"
                type="password"
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && path && pass && void decrypt()}
              />
              {problem && <p className="text-xs text-destructive">{problem}</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-sm">
              <div className="font-medium">{t("backup.summary", { customers: s!.customers, projects: s!.projects, tokens: s!.tokens })}</div>
              <div className="text-xs text-muted-foreground">
                {t("backup.created", { date: new Date(s!.created).toLocaleString(i18n.language), app: s!.app })}
              </div>
            </div>
            {state.config && (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {t("backup.replaceWarning")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {!loaded ? (
            <Button disabled={!path || !pass || busy} onClick={decrypt}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("backup.decrypt")}
            </Button>
          ) : (
            <Button variant={state.config ? "destructive" : "default"} disabled={busy} onClick={replace}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("backup.replace")}
            </Button>
          )}
        </DialogFooter>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
