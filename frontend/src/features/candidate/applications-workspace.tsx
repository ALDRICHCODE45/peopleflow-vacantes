"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowUpRight, Briefcase, Building2, CalendarDays, CircleAlert, CircleDot, MessageSquare, Search } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { StateCard } from "@/components/feedback/state-card";
import { notifyActionResult } from "@/components/feedback/notify";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage, Failure } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { AssessmentsLoading, useWorkspaceAssessments } from "@/features/psychometrics/workspace/mounted";
import { AssessmentBlock, StandaloneAssessments } from "@/features/psychometrics/workspace/assessments";
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
/** Case- and accent-insensitive comparison key (same rule as the former prototype search). */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
const APPLICATION_GRID = "grid gap-4 lg:grid-cols-2";
const APPLICATION_FACTS = "grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2";
const APPLICATION_FOOTER = "mt-auto justify-end border-t";
const STATUS_EXPLANATION = {
  submitted: "Tu postulación fue enviada.",
  in_process: "Tu postulación avanzó en el proceso.",
  closed: "El proceso de tu postulación finalizó.",
} satisfies Record<ApplicationsPage["items"][number]["status"], string>;

function ApplicationCard({ item, assessment }: { item: ApplicationsPage["items"][number]; assessment?: AccountAssessment }) {
  // An active application of a vacancy whose process the company finished (§21.5); a discard keeps «Finalizada».
  const vacancyClosed = item.vacancy.state === "closed";
  return <Card className="h-full min-w-0">
    <CardHeader className="border-b">
      <CardTitle className="flex min-w-0 items-start gap-3">
        <Avatar className="size-11" aria-hidden="true"><AvatarFallback className="bg-primary/12 text-foreground ring-1 ring-primary/40"><Briefcase className="size-5" /></AvatarFallback></Avatar>
        <h3 className="min-w-0 font-heading text-base font-semibold"><Link href={`/vacantes/${item.vacancy.id}`} className="inline-flex min-h-10 items-center rounded-md break-words underline-offset-4 hover:underline focus-visible:outline-ring focus-visible:outline-2">{item.vacancy.title}</Link></h3>
      </CardTitle>
      <CardDescription className="flex min-w-0 items-center gap-1.5 pl-14"><Building2 aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 break-words">{item.company.name}</span></CardDescription>
      <CardAction><Badge variant={item.status === "submitted" ? "info" : item.status === "closed" || vacancyClosed ? "neutral" : "review"} dot>{item.status === "closed" ? "Finalizada" : vacancyClosed ? "Vacante cerrada" : item.status === "submitted" ? "Enviada" : "En proceso"}</Badge></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      <dl className={APPLICATION_FACTS}>
        <div className="flex min-w-0 flex-col gap-1.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" />Postulada</dt><dd><time dateTime={item.applied_at}>{date.format(new Date(item.applied_at))}</time></dd></div>
        <div className="flex min-w-0 flex-col gap-1.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleDot aria-hidden="true" className="size-3.5" />Estado</dt><dd>{item.status !== "closed" && vacancyClosed ? "La empresa cerró esta vacante y finalizó el proceso." : STATUS_EXPLANATION[item.status]}</dd></div>
      </dl>
      {item.status === "closed" && item.message !== null && <div data-pf-application-message className="flex min-w-0 flex-col gap-2 border-l-2 border-border pl-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageSquare aria-hidden="true" className="size-3.5" />Mensaje de la empresa</p>
        <p className="max-w-prose whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.message}</p>
      </div>}
      {assessment && <AssessmentBlock item={assessment} />}
    </CardContent>
    <CardFooter className={APPLICATION_FOOTER}>
      <Link href={`/vacantes/${item.vacancy.id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-10 w-full sm:w-auto")}>Ver vacante<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Link>
    </CardFooter>
  </Card>;
}

function ApplicationsSkeleton() {
  return <section aria-busy="true" aria-label="Postulaciones" className="flex flex-col gap-3">
    <span role="status" className="sr-only">Cargando postulaciones</span>
    <div aria-hidden="true" data-pf-applications-loading-search className="flex flex-col gap-2">
      <Skeleton className="h-[19px] w-52" />
      <Skeleton className="w-full lg:w-72"><InputGroup className="invisible h-11"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput disabled tabIndex={-1} /></InputGroup></Skeleton>
    </div>
    {/* Unknown status: mirror the standard facts card, without inventing a company message. */}
    <ul className={APPLICATION_GRID}>{[0, 1, 2].map(index => <li key={index} className="min-w-0">
      <Card aria-hidden="true" className="h-full min-w-0">
        <CardHeader className="border-b">
          <CardTitle className="flex min-w-0 items-start gap-3"><Skeleton className="size-11 shrink-0 rounded-full" /><Skeleton className="h-10 w-44 max-w-full" /></CardTitle>
          <CardDescription className="pl-14"><Skeleton className="h-5 w-28 max-w-full" /></CardDescription>
          <CardAction><Skeleton className="h-6 w-20" /></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5"><dl className={APPLICATION_FACTS}>{[0, 1].map(key => <div key={key} className="flex min-w-0 flex-col gap-1.5"><dt><Skeleton className="h-4 w-20" /></dt><dd><Skeleton className="h-5 w-full" /></dd></div>)}</dl></CardContent>
        <CardFooter className={APPLICATION_FOOTER}><Skeleton className="h-10 w-full sm:w-32" /></CardFooter>
      </Card>
    </li>)}</ul>
  </section>;
}
export function ApplicationsWorkspace() {
  const assessments = useWorkspaceAssessments();
  const [data, setData] = useState<ApplicationsPage>();
  const [failure, setFailure] = useState<Failure>();
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const locked = useRef(false);
  const [query, setQuery] = useState("");
  const needle = normalize(query);
  const visible = (data?.items ?? []).filter(item => needle === "" || normalize(`${item.vacancy.title} ${item.company.name}`).includes(needle));
  useEffect(() => {
    let active = true;
    void loadApplicationsAction().catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const).then(result => {
      if (!active) return;
      if (result.ok) setData(result.data); else setFailure(result);
    });
    return () => { active = false; };
  }, []);
  async function loadMore() {
    if (locked.current) return;
    locked.current = true; setPending(true);
    const result = await loadApplicationsAction(data?.next_cursor ? { cursor: data.next_cursor } : {}).catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const);
    locked.current = false; setPending(false);
    if (result.ok) {
      setFailure(undefined); setLoaded(true);
      setData(current => ({ ...result.data, items: [...(current?.items ?? []), ...result.data.items.filter(item => !current?.items.some(existing => existing.id === item.id))] }));
      notifyActionResult({ key: "applications-load", type: "success", title: "Postulaciones cargadas", description: "El listado está actualizado con los resultados recibidos." });
    } else {
      setFailure(result);
      notifyActionResult({ key: "applications-load", type: "error", title: "No pudimos cargar las postulaciones", description: "Conservamos el listado. Puedes reintentar sin enviar otra postulación.", reference: { ...result.reference, at: new Date().toISOString() } });
    }
  }
  return <DashboardPageContent data-pf-applications-workspace width="screen-2xl" className="gap-5">
    <header className="flex flex-col gap-2"><h2 className="font-heading text-2xl font-semibold">Postulaciones</h2><p className="max-w-prose text-sm text-muted-foreground">Consulta las vacantes a las que te postulaste.</p></header>
    {!assessments && <AssessmentsLoading />}
    {assessments && !assessments.ok && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las evaluaciones" description="Tus respuestas guardadas se conservan. Vuelve a abrir Postulaciones para consultar tus evaluaciones." primaryAction={{ label: "Consultar de nuevo", href: "/candidato/postulaciones" }} />}
    <StandaloneAssessments items={assessments?.ok ? assessments.data.items.filter(item => item.application_id === null) : []} />
    {!data && !failure ? <ApplicationsSkeleton /> : <>
      {data?.items.length === 0 && !failure && <StateCard icon={Briefcase} tone="empty" title="Todavía no te postulaste a ninguna vacante" description="Tus postulaciones aparecerán aquí cuando envíes una. Mientras tanto, explora las vacantes disponibles." primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }} />}
      {!data && failure && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las postulaciones" description="Tus postulaciones no cambiaron. Vuelve a consultar para verlas."
        primaryAction={failure.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/ingresar" } : { label: pending ? "Cargando…" : "Reintentar", onClick: () => void loadMore(), disabled: pending }}
        secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />}
      {!!data?.items.length && <div className="flex flex-col gap-2">
        <label htmlFor="applications-search" className="text-[12.5px] font-medium text-foreground">Buscar por puesto o empresa</label>
        <InputGroup className="h-11 w-full lg:w-72"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput id="applications-search" type="search" value={query} onChange={event => setQuery(event.target.value)} /></InputGroup>
        {needle !== "" && data.next_cursor && <p className="text-sm text-muted-foreground">La búsqueda cubre las postulaciones cargadas. Carga más para buscar en el resto.</p>}
      </div>}
      {!!data?.items.length && visible.length === 0 && <Empty><EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold">Ninguna postulación coincide con «{query.trim()}».</EmptyTitle><EmptyDescription>Prueba con otro puesto o empresa, o limpia la búsqueda para ver tus postulaciones cargadas.</EmptyDescription></EmptyHeader><EmptyContent className="flex-col sm:flex-row sm:justify-center"><Button className="min-h-10 w-full sm:w-auto" onClick={() => setQuery("")}>Limpiar búsqueda</Button></EmptyContent></Empty>}
      {visible.length > 0 && <ul className={APPLICATION_GRID}>{visible.map(item => <li key={item.id} className="min-w-0"><ApplicationCard item={item} assessment={assessments?.ok ? assessments.data.items.find(assessment => assessment.application_id?.toLowerCase() === item.id.toLowerCase() && assessment.vacancy.id.toLowerCase() === item.vacancy.id.toLowerCase()) : undefined} /></li>)}</ul>}
      {data && (failure || loaded || data.next_cursor) && <ActionBar status={failure ? <ActionStatus id="applications-status" tone="error" text="No pudimos cargar las postulaciones" action={failure.reason === "unauthenticated" ? <Link href="/candidato/ingresar" className="inline-flex min-h-10 items-center underline">Ingresar como candidato</Link> : undefined} /> : loaded ? <ActionStatus id="applications-status" tone="success" text="Postulaciones cargadas" /> : null}>
        {(failure || data?.next_cursor) && <Button variant="outline" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={failure || loaded ? "applications-status" : undefined} onClick={() => void loadMore()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{failure ? "Reintentar" : "Cargar más"}</Button>}
      </ActionBar>}
    </>}
  </DashboardPageContent>;
}
