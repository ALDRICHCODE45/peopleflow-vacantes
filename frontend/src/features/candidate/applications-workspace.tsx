"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, CircleAlert, Search } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { StateCard } from "@/components/feedback/state-card";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage, Failure } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { AssessmentsLoading, useWorkspaceAssessments } from "@/features/psychometrics/workspace/mounted";
import { actionableAssessment, StandaloneAssessments } from "@/features/psychometrics/workspace/assessments";
import { ApplicationDetail, ApplicationRow, ApplicationsSkeleton } from "@/features/candidate-applications/inbox";
type Filter = "all" | "attention" | "process" | "closed";
/** Case- and accent-insensitive comparison key (same rule as the former prototype search). */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
export function ApplicationsWorkspace() {
  const assessments = useWorkspaceAssessments();
  const [data, setData] = useState<ApplicationsPage>();
  const [failure, setFailure] = useState<Failure>();
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const locked = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const needle = normalize(query);
  const items = data?.items ?? [];
  const assessmentFor = (item: ApplicationsPage["items"][number]): AccountAssessment | undefined => assessments?.ok ? assessments.data.items.find(assessment => assessment.application_id?.toLowerCase() === item.id.toLowerCase() && assessment.vacancy.id.toLowerCase() === item.vacancy.id.toLowerCase()) : undefined;
  const matches = (item: ApplicationsPage["items"][number], value: Filter) => value === "all" || (value === "attention" ? !!assessmentFor(item) && actionableAssessment(assessmentFor(item)!, now) : value === "process" ? item.status === "in_process" : item.status === "closed");
  const visible = items.filter(item => matches(item, filter) && (needle === "" || normalize(`${item.vacancy.title} ${item.company.name}`).includes(needle)));
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const filters = [{ value: "all", label: "Todas" }, { value: "attention", label: "Por atender" }, { value: "process", label: "En proceso" }, { value: "closed", label: "Cerradas" }] as const;
  useEffect(() => {
    // Expiry can pass while the inbox remains open; refresh eligibility, not the API.
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const media = window.matchMedia?.("(min-width: 1024px)");
    const closeOnDesktop = () => { if (media?.matches) setMobileOpen(false); };
    media?.addEventListener("change", closeOnDesktop);
    return () => { window.clearInterval(timer); media?.removeEventListener("change", closeOnDesktop); };
  }, []);
  function select(item: ApplicationsPage["items"][number], target: HTMLElement) {
    setSelectedId(item.id); returnFocus.current = target;
    if (window.matchMedia?.("(max-width: 1023px)").matches) setMobileOpen(true);
  }
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
    <header className="flex flex-col gap-2"><h2 className="font-heading text-2xl font-semibold">Mis postulaciones</h2><p className="max-w-prose text-sm text-muted-foreground">Sigue tus procesos y encuentra lo que necesita tu atención.</p></header>
    {!assessments && <AssessmentsLoading />}
    {assessments && !assessments.ok && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las evaluaciones" description="Tus respuestas guardadas se conservan. Vuelve a abrir Postulaciones para consultar tus evaluaciones." primaryAction={{ label: "Consultar de nuevo", href: "/candidato/postulaciones" }} />}
    <StandaloneAssessments items={assessments?.ok ? assessments.data.items.filter(item => item.application_id === null) : []} />
    {!data && !failure ? <ApplicationsSkeleton /> : <>
      {data?.items.length === 0 && !failure && <StateCard icon={Briefcase} tone="empty" title="Todavía no te postulaste a ninguna vacante" description="Tus postulaciones aparecerán aquí cuando envíes una. Mientras tanto, explora las vacantes disponibles." primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }} />}
      {!data && failure && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las postulaciones" description="Tus postulaciones no cambiaron. Vuelve a consultar para verlas."
        primaryAction={failure.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/ingresar" } : { label: pending ? "Cargando…" : "Reintentar", onClick: () => void loadMore(), disabled: pending }}
        secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />}
      {!!data?.items.length && <>
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 overflow-x-auto"><ToggleGroup variant="segmented" value={[filter]} onValueChange={values => { if (values[0]) { setFilter(values[0] as Filter); setMobileOpen(false); } }} aria-label="Filtrar postulaciones">{filters.map(option => <ToggleGroupItem key={option.value} value={option.value}>{option.label}<Badge variant="secondary">{items.filter(item => matches(item, option.value)).length}</Badge></ToggleGroupItem>)}</ToggleGroup></div>
          <label htmlFor="applications-search" className="sr-only">Buscar por puesto o empresa</label>
          <InputGroup className="h-11 w-full xl:w-60"><InputGroupInput id="applications-search" type="search" placeholder="Puesto o empresa" value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup>
        </div>
        {data.next_cursor && <p className="text-sm text-muted-foreground">{needle !== "" ? "La búsqueda cubre las postulaciones cargadas. Carga más para buscar en el resto." : "Los conteos cubren las postulaciones cargadas. Carga más para consultar el resto."}</p>}
      </>}
      {!!data?.items.length && visible.length === 0 && <Empty><EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold">Ninguna postulación coincide con «{query.trim()}».</EmptyTitle><EmptyDescription>Prueba con otro puesto o empresa, o limpia la búsqueda para ver tus postulaciones cargadas.</EmptyDescription></EmptyHeader><EmptyContent className="flex-col sm:flex-row sm:justify-center"><Button className="min-h-10 w-full sm:w-auto" onClick={() => { setQuery(""); setFilter("all"); }}>Limpiar búsqueda</Button></EmptyContent></Empty>}
      {visible.length > 0 && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_368px]">
        <div className="flex min-w-0 flex-col gap-3"><p role="status" className="text-xs text-muted-foreground">{visible.length === 1 ? "1 postulación" : `${visible.length} postulaciones`}</p><ul aria-label="Mis postulaciones" className="grid gap-2">{visible.map(item => <li key={item.id} className="min-w-0"><ApplicationRow item={item} assessment={assessmentFor(item)} now={now} selected={selected?.id === item.id} onSelect={target => select(item, target)} /></li>)}</ul><p className="text-xs text-muted-foreground">Solo verás aquí los estados de tu postulación, no las etapas internas de la empresa.</p></div>
        {selected && <ApplicationDetail item={selected} assessment={assessmentFor(selected)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} returnFocus={returnFocus} />}
      </div>}
      {data && (failure || loaded || data.next_cursor) && <ActionBar status={failure ? <ActionStatus id="applications-status" tone="error" text="No pudimos cargar las postulaciones" action={failure.reason === "unauthenticated" ? <Link href="/candidato/ingresar" className="inline-flex min-h-10 items-center underline">Ingresar como candidato</Link> : undefined} /> : loaded ? <ActionStatus id="applications-status" tone="success" text="Postulaciones cargadas" /> : null}>
        {(failure || data?.next_cursor) && <Button variant="outline" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={failure || loaded ? "applications-status" : undefined} onClick={() => void loadMore()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{failure ? "Reintentar" : "Cargar más"}</Button>}
      </ActionBar>}
    </>}
  </DashboardPageContent>;
}
