import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { AppService, ServiceState } from "@/core/app/service";

const ServiceContext = createContext<AppService | null>(null);

export function ServiceProvider({ service, children }: { service: AppService; children: ReactNode }) {
  return <ServiceContext.Provider value={service}>{children}</ServiceContext.Provider>;
}

export function useService(): AppService {
  const s = useContext(ServiceContext);
  if (!s) throw new Error("ServiceProvider fehlt");
  return s;
}

export function useServiceState(): ServiceState {
  const s = useService();
  return useSyncExternalStore(s.subscribe, s.getState);
}
