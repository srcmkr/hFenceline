import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Globe, KeyRound, Power, Timer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_CHECK_INTERVAL_MINUTES, type Language } from "@/core/model/config";
import { useService, useServiceState } from "../service-context";
import { PageHeader, Section } from "../section";
import { useAction } from "../errors";
import { autostart, isDesktop } from "@/platform/desktop";
import { setLanguage } from "@/i18n";

export function SettingsPage({ location, secretsBackend }: { location: string; secretsBackend: string }) {
  const { t } = useTranslation();
  const service = useService();
  const state = useServiceState();
  const config = state.config!;
  const [auto, setAuto] = useState<boolean | null>(null);
  const [interval, setIntervalValue] = useState(String(config.homeip.check_interval_minutes ?? DEFAULT_CHECK_INTERVAL_MINUTES));

  useEffect(() => {
    void autostart.isEnabled().then(setAuto, () => setAuto(false));
  }, []);

  const [saveLanguage] = useAction(async (lang: Language) => {
    await service.updateConfig((c) => void (c.language = lang));
    setLanguage(lang);
  });
  const [saveAutostart] = useAction(async (on: boolean) => {
    await autostart.set(on);
    await service.updateConfig((c) => void (c.autostart = on));
    setAuto(on);
  });
  const [saveInterval] = useAction(async (minutes: number) => {
    await service.updateConfig((c) => void (c.homeip.check_interval_minutes = minutes));
    service.startHomeIpTimer();
  });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={t("settings.title")} />

      <Section title={t("settings.general")}>
        <div className="divide-y">
          <Row icon={<Globe />} title={t("settings.language")} hint={t("settings.languageHint")}>
            <Select value={config.language} onValueChange={(v) => void saveLanguage(v as Language)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row icon={<Power />} title={t("settings.autostart")} hint={isDesktop ? t("settings.autostartHint") : t("settings.desktopOnly")}>
            <Switch checked={!!auto} disabled={!isDesktop || auto === null} onCheckedChange={(v) => void saveAutostart(v)} />
          </Row>
          <Row icon={<Timer />} title={t("settings.interval")} hint={t("settings.intervalHint")}>
            <div className="flex items-center gap-2">
              <Input
                className="w-20 text-right tabular-nums"
                inputMode="numeric"
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
                onBlur={() => {
                  const n = Number(interval);
                  if (Number.isInteger(n) && n >= 1 && n <= 1440) void saveInterval(n);
                  else setIntervalValue(String(config.homeip.check_interval_minutes ?? DEFAULT_CHECK_INTERVAL_MINUTES));
                }}
              />
              <span className="text-sm text-muted-foreground">{t("settings.minutes")}</span>
            </div>
          </Row>
        </div>
      </Section>

      <Section title={t("settings.storage")}>
        <div className="divide-y">
          <Row icon={<FolderOpen />} title={t("settings.configFile")} hint={t("settings.configFileHint")}>
            <code className="rounded bg-muted px-2 py-1 text-xs">{location}</code>
          </Row>
          <Row icon={<KeyRound />} title={t("settings.tokens")} hint={t(`settings.tokenBackend.${secretsBackend}`, { defaultValue: secretsBackend })}>
            <span />
          </Row>
        </div>
      </Section>

      <p className="text-xs text-muted-foreground">
        hFenceline · {t("app.license")} · {t("app.description")}
      </p>
    </div>
  );
}

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
