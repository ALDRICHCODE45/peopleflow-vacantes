"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Building2, CalendarDays, Search } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage, Failure } from "@/features/candidate-applications/model";
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
/** Case- and accent-insensitive comparison key (same rule as the former prototype search). */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
function ApplicationsSkeleton() {
  return <section aria-busy="true" aria-label="Postulaciones" className="flex flex-col gap-3">
    <span role="status" className="sr-only">Cargando postulaciones</span>
    <div aria-hidden="true" data-pf-applications-loading-search className="flex flex-col gap-2">
      <Skeleton className="h-[19px] w-52" />
      <Skeleton className="w-full lg:w-72"><InputGroup className="invisible h-11"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput disabled tabIndex={-1} /></InputGroup></Skeleton>
    </div>
    {/* Skeletons retain the compact application card anatomy; the initial result count is unknown. */}
    <ul className="flex flex-col gap-3">{[0, 1, 2].map(index => <li key={index} className="min-w-0">
      <Card size="sm" aria-hidden="true">
        <CardHeader>
          <CardTitle className="flex min-w-0 items-start gap-3"><Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className="my-2 h-6 w-44 max-w-full" /></CardTitle>
          <CardDescription><Skeleton className="h-5 w-28" /></CardDescription>
          <CardAction><Skeleton className="h-6 w-20" /></CardAction>
        </CardHeader>
        <CardFooter><Skeleton className="h-5 w-60 max-w-full" /></CardFooter>
      </Card>
    </li>)}</ul>
  </section>;
}
export function ApplicationsWorkspace() {
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
    {!data && !failure ? <ApplicationsSkeleton /> : <>
      {data?.items.length === 0 && !failure && <Empty><EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold">Todavía no te postulaste a ninguna vacante</EmptyTitle><EmptyDescription>Tus postulaciones aparecerán aquí cuando envíes una. Mientras tanto, explora las vacantes disponibles.</EmptyDescription></EmptyHeader><EmptyContent className="flex-col sm:flex-row sm:justify-center"><Link href="/vacantes" className={buttonVariants({ className: "min-h-10 w-full sm:w-auto" })}>Explorar vacantes</Link></EmptyContent></Empty>}
      {!!data?.items.length && <div className="flex flex-col gap-2">
        <label htmlFor="applications-search" className="text-[12.5px] font-medium text-foreground">Buscar por puesto o empresa</label>
        <InputGroup className="h-11 w-full lg:w-72"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput id="applications-search" type="search" value={query} onChange={event => setQuery(event.target.value)} /></InputGroup>
        {needle !== "" && data.next_cursor && <p className="text-sm text-muted-foreground">La búsqueda cubre las postulaciones cargadas. Carga más para buscar en el resto.</p>}
      </div>}
      {!!data?.items.length && visible.length === 0 && <Empty><EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold">Ninguna postulación coincide con «{query.trim()}».</EmptyTitle><EmptyDescription>Prueba con otro puesto o empresa, o limpia la búsqueda para ver tus postulaciones cargadas.</EmptyDescription></EmptyHeader><EmptyContent className="flex-col sm:flex-row sm:justify-center"><Button className="min-h-10 w-full sm:w-auto" onClick={() => setQuery("")}>Limpiar búsqueda</Button></EmptyContent></Empty>}
      {visible.length > 0 && <ul className="flex flex-col gap-3">{visible.map(item => <li key={item.id} className="min-w-0">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-foreground ring-1 ring-primary/40"><Briefcase className="size-5" /></span>
              <h3 className="min-w-0 font-heading text-base font-semibold"><Link href={`/vacantes/${item.vacancy.id}`} className="inline-flex min-h-10 items-center rounded-md break-words underline-offset-4 hover:underline focus-visible:outline-ring focus-visible:outline-2">{item.vacancy.title}</Link></h3>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5"><Building2 aria-hidden="true" className="size-3.5 shrink-0" /><span className="min-w-0 break-words">{item.company.name}</span></CardDescription>
            <CardAction><Badge variant={item.status === "submitted" ? "info" : item.status === "closed" ? "neutral" : "review"} dot>{item.status === "submitted" ? "Enviada" : item.status === "closed" ? "Finalizada" : "En proceso"}</Badge></CardAction>
          </CardHeader>
          {item.status === "closed" && item.message !== null && <CardContent><p className="max-w-prose whitespace-pre-wrap break-words text-sm">{item.message}</p></CardContent>}
          <CardFooter><p className="flex flex-wrap items-center gap-1.5 text-sm"><CalendarDays aria-hidden="true" className="size-3.5 shrink-0" /><span className="text-muted-foreground">Postulada</span><time dateTime={item.applied_at}>{date.format(new Date(item.applied_at))}</time></p></CardFooter>
        </Card>
      </li>)}</ul>}
      {(failure || loaded || data?.next_cursor) && <ActionBar status={failure ? <ActionStatus id="applications-status" tone="error" text="No pudimos cargar las postulaciones" action={failure.reason === "unauthenticated" ? <Link href="/candidato/ingresar" className="inline-flex min-h-10 items-center underline">Ingresar como candidato</Link> : undefined} /> : loaded ? <ActionStatus id="applications-status" tone="success" text="Postulaciones cargadas" /> : null}>
        {(failure || data?.next_cursor) && <Button variant="outline" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={failure || loaded ? "applications-status" : undefined} onClick={() => void loadMore()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{failure ? "Reintentar" : "Cargar más"}</Button>}
      </ActionBar>}
    </>}
  </DashboardPageContent>;
}
