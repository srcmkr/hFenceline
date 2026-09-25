import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  Plus,
  Server as ServerIcon,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProjectView } from "@/core/app/overview";
import type { Firewall } from "@/core/hetzner/types";
import { useService } from "../service-context";
import { PageHeader, Section } from "../section";
import { StatusBadge, StatusDot } from "../status";
import { errorText, useAction } from "../errors";
import { useNav } from "../navigation";
import { ManageDialog } from "../dialogs/manage-dialog";
import { NewFirewallDialog } from "../dialogs/new-firewall-dialog";
import { TokenDialog } from "../dialogs/project-dialog";
import { ConfirmDialog } from "../dialogs/confirm-dialog";
import { consoleUrl, openUrl } from "@/platform/desktop";

export function ProjectPage({ view }: { view: ProjectView }) {
  const { t } = useTranslation();
  const service = useService();
  const nav = useNav();
  const [manage, setManage] = useState<Firewall | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [remove] = useAction(async () => {
    await service.removeProject(view.customer.id, view.project.id);
    nav.go({ kind: "dashboard" });
  });

  const d = view.data;
  const err = d?.error ? errorText(t, d.error) : null;
  const managedIds = new Set(view.project.firewalls.map((f) => f.hetzner_id));
  const fwName = (id: number) => d?.firewalls.find((f) => f.id === id)?.name ?? `#${id}`;
  const openConsole = (serverId?: number) => void openUrl(consoleUrl(view.project.console_project_id, serverId));

  return (
    <div className="space-y-6">
      <PageHeader
        subtitle={view.customer.name}
        title={view.project.name}
        badges={<StatusBadge state={d?.loading && !d.loadedAt ? "unknown" : view.state} />}
        actions={
          <>
            <Button onClick={() => setNewOpen(true)} disabled={!!d?.error || !d?.loadedAt}>
              <Plus className="size-4" />
              {t("project.newFirewall")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("common.more")}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setTokenOpen(true)}>
                  <KeyRound className="size-4" />
                  {t("token.change")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openConsole()}>
                  <ExternalLink className="size-4" />
                  {t("firewall.openConsole")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
                  <Trash2 className="size-4" />
                  {t("project.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {err && (
        <Alert variant="destructive">
          <ShieldQuestion />
          <AlertTitle>{err.title}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{err.detail}</span>
            <Button size="sm" variant="outline" onClick={() => setTokenOpen(true)}>
              <KeyRound className="size-3.5" />
              {t("token.change")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {view.unprotected.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/[0.06]">
          <ShieldOff className="text-amber-600" />
          <AlertTitle>{t("servers.unprotectedTitle", { count: view.unprotected.length })}</AlertTitle>
          <AlertDescription>
            <p>{t("servers.unprotectedText")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {view.unprotected.map((s) => (
                <Button key={s.id} size="sm" variant="outline" onClick={() => openConsole(s.id)}>
                  {s.name}
                  <ExternalLink className="size-3" />
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {view.onlyUnmanaged.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/[0.06]">
          <ShieldQuestion className="text-amber-600" />
          <AlertTitle>{t("servers.onlyUnmanagedTitle", { count: view.onlyUnmanaged.length })}</AlertTitle>
          <AlertDescription>{t("servers.onlyUnmanagedText", { names: view.onlyUnmanaged.map((s) => s.name).join(", ") })}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t("project.managed")} icon={<ShieldCheck />} description={t("project.managedHint")}>
          {view.firewalls.length === 0 ? (
            <div className="space-y-3 p-4 text-sm text-muted-foreground">
              <p>{t("project.noManaged")}</p>
              {view.unmanaged.length === 0 && d?.loadedAt && !d.error && (
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus className="size-4" />
                  {t("project.newFirewall")}
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {view.firewalls.map((f) => (
                <button
                  key={f.key}
                  onClick={() => nav.go({ kind: "firewall", key: f.key })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <StatusDot state={f.state} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.template?.name ?? f.config.template} · {t("servers.count", { count: f.servers.length })}
                    </div>
                  </div>
                  <StatusBadge state={f.state} />
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title={t("project.unmanaged")} icon={<ShieldQuestion />} description={t("project.unmanagedHint")}>
          {view.unmanaged.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{d?.loadedAt ? t("project.noUnmanaged") : t("common.loading")}</p>
          ) : (
            <div className="divide-y">
              {view.unmanaged.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("project.rulesCount", { count: f.rules.length })}
                      {f.labels["managed-by"] === "hfenceline" && ` · ${t("project.labeledButUnknown")}`}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setManage(f)}>
                    {t("project.manage")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title={t("servers.title")} icon={<ServerIcon />} description={t("servers.hint")} bodyClassName="overflow-x-auto">
        {view.servers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{d?.loadedAt ? t("servers.none") : t("common.loading")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t("servers.name")}</TableHead>
                <TableHead>{t("servers.ip")}</TableHead>
                <TableHead>{t("servers.firewalls")}</TableHead>
                <TableHead className="pr-4 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.servers.map((s) => {
                const fws = s.public_net.firewalls;
                const managed = fws.some((x) => managedIds.has(x.id));
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.public_net.ipv4?.ip ?? "-"}</TableCell>
                    <TableCell>
                      {fws.length === 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <ShieldOff className="size-3.5" />
                          {t("servers.noFirewall")}
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {fws.map((x) => (
                            <span
                              key={x.id}
                              className={
                                managedIds.has(x.id)
                                  ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                                  : "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                              }
                            >
                              {fwName(x.id)}
                            </span>
                          ))}
                          {!managed && <span className="text-xs text-amber-700 dark:text-amber-400">· {t("servers.notManaged")}</span>}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openConsole(s.id)} aria-label={t("firewall.openConsole")}>
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      {manage && (
        <ManageDialog
          projectKey={view.key}
          firewall={manage}
          open={!!manage}
          onOpenChange={(o) => !o && setManage(null)}
          onDone={(key) => nav.go({ kind: "firewall", key })}
        />
      )}
      <NewFirewallDialog project={view} open={newOpen} onOpenChange={setNewOpen} onCreated={(key) => nav.go({ kind: "firewall", key })} />
      <TokenDialog customerId={view.customer.id} projectId={view.project.id} open={tokenOpen} onOpenChange={setTokenOpen} />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t("project.removeTitle", { name: view.project.name })}
        description={t("project.removeText")}
        confirmLabel={t("project.remove")}
        destructive
        onConfirm={() => remove()}
      />
    </div>
  );
}
