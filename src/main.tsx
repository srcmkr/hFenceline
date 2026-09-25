import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App";
import { createService } from "./platform";
import { ServiceProvider } from "./ui/service-context";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", media.matches);
applyTheme();
media.addEventListener("change", applyTheme);

const service = createService();
void service.start().then(() => service.startHomeIpTimer());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServiceProvider service={service}>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </ServiceProvider>
  </StrictMode>,
);
