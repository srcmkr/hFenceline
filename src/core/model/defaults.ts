import type { Config, Language, Template } from "./config";
import { SOURCE_ANY, SOURCE_HOME, SOURCE_STATIC } from "./config";

const NAMES: Record<Language, Record<string, string>> = {
  de: {
    template: "Standard",
    web: "Web öffentlich",
    admin: "Admin von zu Hause",
    static: "Feste IPs",
    ping: "Ping",
  },
  en: {
    template: "Standard",
    web: "Public web",
    admin: "Admin from home",
    static: "Static IPs",
    ping: "Ping",
  },
};

export function standardTemplate(language: Language): Template {
  const n = NAMES[language];
  return {
    id: "standard",
    name: n.template!,
    blocks: [
      {
        id: "web",
        name: n.web!,
        rules: [
          { protocol: "tcp", port: "80", from: [SOURCE_ANY] },
          { protocol: "tcp", port: "443", from: [SOURCE_ANY] },
        ],
      },
      { id: "admin", name: n.admin!, rules: [{ protocol: "all", from: [SOURCE_HOME] }] },
      { id: "static", name: n.static!, rules: [{ protocol: "all", from: [SOURCE_STATIC] }] },
      {
        id: "ping",
        name: n.ping!,
        optional: true,
        default: false,
        rules: [{ protocol: "icmp", from: [SOURCE_ANY] }],
      },
    ],
  };
}

export function defaultConfig(language: Language): Config {
  return {
    version: 1,
    language,
    homeip: {},
    templates: [standardTemplate(language)],
    customers: [],
  };
}
