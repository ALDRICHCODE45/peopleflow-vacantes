"use client";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, CalendarDays, CircleAlert, MapPin } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { StateCard } from "@/components/feedback/state-card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useIdentity } from "@/features/identity/identity-session";
import type { Identity } from "@/features/identity/model";
import { candidateAuthHref } from "@/features/identity/return-to";
import { vacancyApplicationHref } from "@/features/jobs/application/application-draft";
import { PublicCompanyAvatar } from "@/features/jobs/components/PublicCompanyAvatar";
import { previewSalaryParts } from "@/features/jobs/create/form/preview-salary";
import { formatPublishedDate, workModeLabel } from "@/features/jobs/formatters";
import { loadSavedJobsAction, removeSavedJobAction, removeClosedSavedJobsAction, saveJobAction } from "@/features/saved-vacancies/actions";
import { workspaceErrorCopy } from "@/features/saved-vacancies/workspace/feedback";
import type { SavedJobItem, SavedJobsFailure } from "@/features/saved-vacancies/model";
import { savedJobIdsKey, savedJobsKey, savedJobsQueryClient, updateSavedJobIds } from "@/features/saved-vacancies/queries";
import { applicationHref } from "@/features/saved-vacancies/workspace/application-href";

const plural = (n: number, singular: string, multiple: string) => `${n} ${n === 1 ? singular : multiple}`;
const noResponse: SavedJobsFailure = { ok: false, reason: "no_response", reference: {} };
type Line = { tone: "success" | "error"; text: string; action?: { title: string; onClick: () => void } };

/** Initial read uses the same card slots as the loaded rows; refetch keeps useful content mounted. */
function LoadingSavedJobs() {
  return <section aria-busy="true" aria-label="Vacantes guardadas" className="grid gap-4">
    <span role="status" className="sr-only">Cargando vacantes guardadas</span>
    <Skeleton aria-hidden="true" className="h-6 w-48" />
    {[0, 1].map(key => <Card key={key} size="sm" aria-hidden="true" data-pf-saved-loading>
      <CardHeader><CardTitle className="flex min-w-0 items-start gap-3"><Skeleton className="size-12 shrink-0" /><Skeleton className="h-6 w-64 max-w-full" /></CardTitle><CardDescription><Skeleton className="h-4 w-40" /></CardDescription><CardAction><Skeleton className="size-10" /></CardAction></CardHeader>
      <CardContent className="grid gap-2"><Skeleton className="h-4 w-52" /><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-40" /></CardContent>
      <CardFooter><Skeleton className="h-10 w-40" /></CardFooter>
    </Card>)}
  </section>;
}

function SavedRow({ item, pending, onRemove, statusId }: { item: SavedJobItem; pending: boolean; onRemove: () => void; statusId?: string }) {
  const { job } = item;
  const salary = previewSalaryParts(job);
  const open = item.availability === "open";
  return <li className="min-w-0"><Card size="sm" data-pf-saved-vacancy={item.job_id}>
    <CardHeader>
      <CardTitle className="flex min-w-0 items-start gap-3"><PublicCompanyAvatar company={job.company} /><h3 className="min-w-0 break-words text-base font-semibold">{job.title}</h3></CardTitle>
      <CardDescription>{job.company.name}</CardDescription>
      <CardAction><Button type="button" variant="ghost" size="icon" className="size-10" disabled={pending} aria-busy={pending} aria-pressed="true" aria-describedby={statusId} aria-label={`Quitar ${job.title} de guardadas`} onClick={onRemove}>{pending ? <Spinner aria-hidden="true" /> : <Bookmark aria-hidden="true" className="fill-current" />}</Button></CardAction>
    </CardHeader>
    <CardContent className="grid gap-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin aria-hidden="true" className="size-4 shrink-0" />{[job.location_label, workModeLabel(job.work_mode)].filter(Boolean).join(" · ")}</p>
      <div><p className="font-semibold tabular-nums">{salary ? `${salary.amount} ${salary.currency}` : "Salario no publicado"}</p>{salary && <p className="text-xs text-muted-foreground">{salary.cadence ?? "Periodicidad y neto/bruto no especificados"}</p>}</div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4" />Guardada el {formatPublishedDate(item.saved_at)}</p>
      {!open && item.closed_at && <p className="text-xs text-muted-foreground">Cerró el {formatPublishedDate(item.closed_at)}</p>}
      {!open ? <Badge variant="neutral">Ya no disponible</Badge> : item.application && <Badge variant="info">Ya te postulaste</Badge>}
    </CardContent>
    {/* Direction 03 explicitly pairs the next-step CTA with lower-weight vacancy navigation;
        the bookmark remains a separate toggle in CardAction, not a footer action tray. */}
    <CardFooter className="flex-wrap gap-2">
      {open && item.application ? <Link href={applicationHref(item.application.id)} className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}>Ver postulación</Link>
        : open && job.source === "vacancy" && <Link href={vacancyApplicationHref(item.job_id)} className={buttonVariants({ className: "min-h-10" })}>Postularme</Link>}
      <Link href={`/vacantes/${item.job_id}`} className={buttonVariants({ variant: "ghost", className: "min-h-10" })}>Ver vacante</Link>
    </CardFooter>
  </Card></li>;
}

export function SavedVacanciesWorkspace() {
  const identity = useIdentity();
  if (identity.status !== "ready" || !identity.result?.ok || identity.result.data.role !== "candidate") return <LoadingSavedJobs />;
  return <CandidateSavedJobs key={identity.result.data.user.id} identity={identity.result.data} />;
}

function CandidateSavedJobs({ identity }: { identity: Identity }) {
  const client = savedJobsQueryClient(identity);
  const list = useQuery({ queryKey: savedJobsKey, queryFn: async () => {
    const result = await loadSavedJobsAction().catch(() => noResponse);
    if (!result.ok) throw result;
    return result.data;
  } }, client);
  const [line, setLine] = useState<Line>();
  const [busy, setBusy] = useState<string>();
  const locked = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const bulkButton = useRef<HTMLButtonElement>(null);
  const items = list.data?.items ?? [];
  const pending = items.filter(item => item.availability === "open" && !item.application);
  const applied = items.filter(item => item.availability === "open" && item.application);
  const closed = items.filter(item => item.availability === "closed");

  function failure(result: SavedJobsFailure, retry: () => void, removing: boolean) {
    const copy = workspaceErrorCopy(result, removing);
    const action = result.reason === "unauthenticated" ? { title: "Iniciar sesión", onClick: () => { window.location.assign(candidateAuthHref("login", "/candidato/guardadas")); } }
      : copy.retry ? { title: "Reintentar", onClick: retry } : undefined;
    setLine({ tone: "error", text: copy.title, action });
    notifyActionResult({ key: "saved-workspace", type: "error", title: copy.title, description: copy.description, action, reference: { ...result.reference, at: new Date().toISOString() } });
  }
  async function mutate(kind: "remove" | "undo" | "bulk", id?: string) {
    if (locked.current || (id && client.isMutating({ mutationKey: ["saved-jobs", "toggle", id] }))) return;
    locked.current = true; setBusy(id ?? "bulk"); setLine(undefined);
    try {
      const result = await (kind === "bulk" ? removeClosedSavedJobsAction() : kind === "remove" ? removeSavedJobAction(id!) : saveJobAction(id!)).catch(() => noResponse);
      if (!result.ok) { failure(result, () => void mutate(kind, id), kind !== "undo"); return; }
      if (kind === "bulk") {
        // Availability may have changed since the list read: never infer deleted IDs.
        await client.invalidateQueries({ queryKey: savedJobsKey });
        setConfirm(false);
      } else {
        updateSavedJobIds(client, id!, kind === "undo");
        await client.invalidateQueries({ queryKey: savedJobsKey });
      }
      await client.invalidateQueries({ queryKey: savedJobIdsKey });
      const title = kind === "bulk" && "removed" in (result.data ?? {})
        ? `Quitaste ${plural((result.data as { removed: number }).removed, "vacante", "vacantes")}`
        : kind === "remove" ? "Quitaste la vacante" : "Vacante guardada";
      const action = kind === "remove" ? { title: "Deshacer", onClick: () => void mutate("undo", id) } : undefined;
      setLine({ tone: "success", text: title, action });
      notifyActionResult({ key: "saved-workspace", type: "success", title, description: kind === "undo" ? "La encontrarás en tus guardadas." : "Tus postulaciones no cambiaron.", action });
      if (kind === "remove" && document.activeElement === document.body) heading.current?.focus();
    } finally { locked.current = false; setBusy(undefined); }
  }
  const status = line ? <ActionStatus id="saved-workspace-status" tone={line.tone} text={line.text} action={line.action && <Button type="button" variant="link" className="min-h-10" disabled={!!busy} onClick={line.action.onClick}>{line.action.title}</Button>} /> : null;
  const rows = (values: SavedJobItem[], label: string) => <ul aria-label={label} className="grid gap-3">{values.map(item => <SavedRow key={item.job_id} item={item} pending={busy === item.job_id || busy === "bulk"} statusId={line ? "saved-workspace-status" : undefined} onRemove={() => void mutate("remove", item.job_id)} />)}</ul>;
  return <DashboardPageContent data-pf-saved-vacancies-workspace width="screen-2xl" className="gap-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1.5"><h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Vacantes guardadas</h2><p className="text-sm text-muted-foreground">Retoma tu búsqueda por el siguiente paso.</p>
        {list.data && list.data.total >= 200 && <p className="max-w-prose text-sm text-muted-foreground">Llegaste al límite de 200 vacantes guardadas. Quita alguna para guardar otra.</p>}
      </div>
      {list.data && <p className="text-sm font-medium tabular-nums">{plural(list.data.total, "guardada", "guardadas")} · {pending.length} por postularte</p>}
    </header>
    <ActionBar status={!confirm ? status : null}>{null}</ActionBar>
    {!list.data ? list.isPending ? <LoadingSavedJobs /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tus vacantes guardadas" description="Tus guardadas no cambiaron. Vuelve a consultar para verlas." primaryAction={{ label: list.isFetching ? "Cargando…" : "Reintentar", disabled: list.isFetching, onClick: () => void list.refetch() }} />
      : items.length === 0 ? <StateCard icon={Bookmark} tone="empty" title="Todavía no tienes vacantes guardadas" description="Guarda las vacantes que te interesen para postularte cuando estés listo o lista." primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }} />
        : <div className="grid gap-7">
          {pending.length > 0 && <section aria-labelledby="saved-pending"><h2 id="saved-pending" className="mb-3 flex items-center gap-2 text-lg font-semibold">Por postularte <Badge variant="neutral">{pending.length}</Badge></h2>{rows(pending, "Por postularte")}</section>}
          {applied.length > 0 && <section aria-labelledby="saved-applied"><h2 id="saved-applied" className="mb-3 flex items-center gap-2 text-lg font-semibold">Ya te postulaste <Badge variant="neutral">{applied.length}</Badge></h2>{rows(applied, "Ya te postulaste")}</section>}
          {closed.length > 0 && <Accordion defaultValue={[]}><AccordionItem value="closed"><AccordionTrigger className="min-h-10">Ya no disponibles <Badge variant="neutral">{closed.length}</Badge></AccordionTrigger><AccordionContent>
            {rows(closed, "Ya no disponibles")}
            <ActionBar status={null}><Button ref={bulkButton} type="button" variant="ghost" className="mt-4 min-h-10 max-w-full whitespace-normal text-left" disabled={!!busy} onClick={() => setConfirm(true)}>Quitar las que ya no están disponibles</Button></ActionBar>
          </AccordionContent></AccordionItem></Accordion>}
        </div>}
    <ConfirmActionDialog open={confirm} onOpenChange={setConfirm} onConfirm={() => void mutate("bulk")} finalFocus={bulkButton} icon={Bookmark} tone="destructive" title="¿Quitar las vacantes no disponibles?" description="Se quitarán de tus guardadas. Tus postulaciones no cambian. Para volver a guardarlas tendrás que encontrarlas de nuevo." confirmLabel="Quitar vacantes" pendingLabel="Quitando…" pending={busy === "bulk"}>
      <p>{plural(closed.length, "vacante no disponible", "vacantes no disponibles")}</p>
      {line?.tone === "error" && status}
    </ConfirmActionDialog>
  </DashboardPageContent>;
}
