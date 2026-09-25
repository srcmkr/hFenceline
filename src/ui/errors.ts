import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HetznerError } from "@/core/hetzner/client";
import { HomeIpError } from "@/core/homeip/homeip";
import { ConfigError } from "@/core/store/config-store";
import { SecretStoreError } from "@/core/ports";

export function errorText(t: TFunction, e: unknown): { title: string; detail?: string } {
  if (e instanceof HetznerError) {
    return { title: t(`errors.hetzner.${e.code}`, { defaultValue: t("errors.hetzner.other") }), detail: e.message };
  }
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "unknown_template") {
    return { title: t("errors.unknownTemplate"), detail: (e as { message?: string }).message };
  }
  if (e instanceof HomeIpError) return { title: t(`errors.homeip.${e.code}`), detail: e.message };
  if (e instanceof SecretStoreError) return { title: t(`errors.secrets.${e.code}`), detail: e.message };
  if (e instanceof ConfigError) return { title: t("errors.config"), detail: e.problems.join("\n") };
  return { title: t("errors.unexpected"), detail: e instanceof Error ? e.message : String(e) };
}

export function useErrorToast() {
  const { t } = useTranslation();
  return useCallback(
    (e: unknown) => {
      const { title, detail } = errorText(t, e);
      toast.error(title, { description: detail });
    },
    [t],
  );
}

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const showError = useErrorToast();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      try {
        return await fn(...args);
      } catch (e) {
        showError(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fn, showError],
  );
  return [run, busy] as const;
}
