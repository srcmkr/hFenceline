import { createContext, useContext } from "react";
import type { FirewallKey, ProjectKey } from "@/core/app/overview";

export type View =
  | { kind: "dashboard" }
  | { kind: "project"; key: ProjectKey }
  | { kind: "firewall"; key: FirewallKey }
  | { kind: "templates"; templateId?: string }
  | { kind: "log" }
  | { kind: "settings" };

export const NavContext = createContext<{ view: View; go: (v: View) => void }>({
  view: { kind: "dashboard" },
  go: () => {},
});

export const useNav = () => useContext(NavContext);
