import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";
import type { Language } from "@/core/model/config";

export function systemLanguage(): Language {
  const langs = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
  return langs.some((l) => l?.toLowerCase().startsWith("de")) ? "de" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: systemLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lang: Language) {
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export default i18n;
