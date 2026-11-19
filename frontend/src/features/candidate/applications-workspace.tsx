"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, Search, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage, Failure } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { AssessmentsLoading, useWorkspaceAssessments } from "@/features/psychometrics/workspace/mounted";
import { actionableAssessment, StandaloneAssessments } from "@/features/psychometrics/workspace/assessments";
import { ApplicationDetail, ApplicationRow, ApplicationsSkeleton, FirstApplication, SummarySkeleton, useCompact } from "@/features/candidate-applications/inbox";
import { isUnread } from "@/features/candidate/dashboard/insights";
import { CARD } from "@/features/candidate/saved/queue";
import motion from "@/features/candidate/saved/saved.module.css";
type Filter = "all" | "attention" | "process" | "closed";
/** Case- and accent-insensitive comparison key (same rule as the former prototype search). */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
const plural = (n: number, one: string, many: string) => n === 1 ? one : many;
/** A message counts as seen once its revision has been on screen (the read acknowledgment is fire-and-forget). */
const revision = (item: ApplicationsPage["items"][number]) => `${item.id}:${item.updated_at ?? ""}`;
export function ApplicationsWorkspace({ initialApplicationId }: { initialApplicationId?: string } = {}) {
  const assessments = useWorkspaceAssessments();
  const [data, setData] = useState<ApplicationsPage>();
  const [failure, setFailure] = useState<Failure>();
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const locked = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // The URL is an entry hint only; keep subsequent selections local (no router dependency).
  const [selectedId, setSelectedId] = useState<string | undefined>(initialApplicationId);
  const initialSelectionHandled = useRef(false);
  const attemptedReads = useRef(new Set<string>());
  const [mobileOpen, setMobileOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const compact = useCompact();
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [entrance, setEntrance] = useState<"idle" | "on" | "off">("idle");
  const needle = normalize(query);
  const items = data?.items ?? [];
  const assessmentFor = (item: ApplicationsPage["items"][number]): AccountAssessment | undefined => assessments?.ok ? assessments.data.items.find(assessment => assessment.application_id?.toLowerCase() === item.id.toLowerCase() && assessment.vacancy.id.toLowerCase() === item.vacancy.id.toLowerCase()) : undefined;
  const matches = (item: ApplicationsPage["items"][number], value: Filter) => value === "all" || (value === "attention" ? !!assessmentFor(item) && actionableAssessment(assessmentFor(item)!, now) : value === "process" ? item.status === "in_process" : item.status === "closed");
  const visible = items.filter(item => matches(item, filter) && (needle === "" || normalize(`${item.vacancy.title} ${item.company.name}`).includes(needle)));
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const filters = [{ value: "all", label: "Todas", title: "Tus postulaciones" }, { value: "attention", label: "Por atender", title: "Por atender" }, { value: "process", label: "En proceso", title: "En proceso" }, { value: "closed", label: "Cerradas", title: "Cerradas" }] as const;
  const count = (value: Filter) => items.filter(item => matches(item, value)).length;
  // The selected record is on screen beside the list (wide) or in the full-screen detail (compact).
  const displayed = selected && (mobileOpen || !compact) ? selected : undefined;
  if (displayed && isUnread(displayed) && !seen.has(revision(displayed))) setSeen(new Set(seen).add(revision(displayed)));
  // One entrance, on the first render with content; `.enter` is dropped once it has played.
  if (data && entrance === "idle") setEntrance("on");
  useEffect(() => {
    if (entrance !== "on") return;
    const timer = setTimeout(() => setEntrance("off"), 700);
    return () => clearTimeout(timer);
  }, [entrance]);
  useEffect(() => {
    // Expiry can pass while the inbox remains open; refresh eligibility, not the API.
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const media = window.matchMedia?.("(min-width: 1024px)");
    const closeOnDesktop = () => { if (media?.matches) setMobileOpen(false); };
    media?.addEventListener("change", closeOnDesktop);
    return () => { window.clearInterval(timer); media?.removeEventListener("change", closeOnDesktop); };
  }, []);
  useEffect(() => {
    if (initialSelectionHandled.current || !data) return;
    const linked = data.items.find(item => item.id === initialApplicationId);
    if (!linked) return;
    initialSelectionHandled.current = true;
    // Use the same row activation as a tap, including mobile detail and return focus.
    const target = document.querySelector<HTMLElement>(`[data-pf-application-row][data-selected="true"] a`);
    if (target) select(linked, target);
  }, [data, initialApplicationId]);
  useEffect(() => {
    if (!selected || (!mobileOpen && window.matchMedia?.("(max-width: 1023px)").matches)) return;
    const token = `${selected.id}:${selected.updated_at}`;
    if (!isUnread(selected) || !selected.updated_at || attemptedReads.current.has(token)) return;
    attemptedReads.current.add(token);
    // Acknowledgment uses the exact displayed revision and must never interrupt reading.
    void markMessageReadAction(selected.id, { updated_at: selected.updated_at }).catch(() => {});
  }, [selected, mobileOpen]);
  function select(item: ApplicationsPage["items"][number], target: HTMLElement) {
    initialSelectionHandled.current = true;
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
  const filterTitle = filters.find(option => option.value === filter)!;
  return <DashboardPageContent data-pf-applications-workspace width="screen-2xl" className={cn("gap-6", entrance === "on" && motion.enter)}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="grid min-w-0 gap-1">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">Mis postulaciones</h2>
        {!data && !failure && <SummarySkeleton />}
        {data && (items.length === 0 ? <p className="text-sm text-muted-foreground">Aún no te postulas a ninguna vacante.</p>
          : <p data-pf-applications-summary className="text-sm text-muted-foreground tabular-nums"><span className="font-semibold text-foreground">{items.length}</span> {plural(items.length, "postulación", "postulaciones")} · <span className="font-semibold text-foreground">{count("process")}</span> en proceso · <span className="font-semibold text-foreground">{count("closed")}</span> {plural(count("closed"), "cerrada", "cerradas")}</p>)}
      </div>
      {!!data?.items.length && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
        {/* Below sm a 2×2 grid keeps all four filters and counts in view; sm and up keep the single segmented row. */}
        <ToggleGroup variant="segmented" className="max-sm:grid max-sm:h-auto! max-sm:w-full max-sm:grid-cols-2 sm:h-11!" value={[filter]} onValueChange={values => { if (values[0]) { setFilter(values[0] as Filter); setMobileOpen(false); } }} aria-label="Filtrar postulaciones">{filters.map(option => <ToggleGroupItem key={option.value} value={option.value} className="max-sm:h-9!">{option.label}<Badge variant="secondary">{count(option.value)}</Badge></ToggleGroupItem>)}</ToggleGroup>
        <label htmlFor="applications-search" className="sr-only">Buscar por puesto o empresa</label>
        <InputGroup className="h-11 w-full sm:w-60"><InputGroupInput id="applications-search" type="search" placeholder="Puesto o empresa" value={query} onChange={event => setQuery(event.target.value)} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup>
      </div>}
    </header>
    {!!data?.items.length && data.next_cursor && <p className="text-sm text-muted-foreground">{needle !== "" ? "La búsqueda cubre las postulaciones cargadas. Carga más para buscar en el resto." : "Los conteos cubren las postulaciones cargadas. Carga más para consultar el resto."}</p>}
    {!assessments && <AssessmentsLoading />}
    {assessments && !assessments.ok && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las evaluaciones" description="Tus respuestas guardadas se conservan. Vuelve a abrir Postulaciones para consultar tus evaluaciones." primaryAction={{ label: "Consultar de nuevo", href: "/candidato/postulaciones" }} />}
    <StandaloneAssessments items={assessments?.ok ? assessments.data.items.filter(item => item.application_id === null) : []} />
    {!data && !failure ? <ApplicationsSkeleton /> : <>
      {data?.items.length === 0 && !failure && <FirstApplication />}
      {!data && failure && <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las postulaciones" description="Tus postulaciones no cambiaron. Vuelve a consultar para verlas."
        primaryAction={failure.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/ingresar" } : { label: pending ? "Cargando…" : "Reintentar", onClick: () => void loadMore(), disabled: pending }}
        secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />}
      {!!data?.items.length && <div className={cn("grid items-start gap-6", selected && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
        <section aria-labelledby="applications-list-title" className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2", motion.rise)}>
          <div className="px-2.5 pb-2 sm:px-3">
            <h3 id="applications-list-title" className="flex items-center gap-2 text-lg leading-7 font-semibold">{filterTitle.title} <Badge variant="neutral">{visible.length}</Badge></h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Solo ves el estado de tu postulación, no las etapas internas de la empresa.</p>
          </div>
          {visible.length > 0 ? <ul aria-label="Mis postulaciones" className="flex flex-col gap-1">{visible.map(item => <li key={item.id} className="min-w-0"><ApplicationRow item={item} assessment={assessmentFor(item)} now={now} compact={compact} unread={isUnread(item) && !seen.has(revision(item))} selected={selected?.id === item.id} onSelect={target => select(item, target)} /></li>)}</ul>
            : <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados"
              description={query.trim() ? `Ninguna de las postulaciones cargadas coincide con «${query.trim()}». Limpia los filtros para verlas de nuevo.` : `No hay postulaciones cargadas con el filtro «${filterTitle.label}». Limpia los filtros para volver a ver tu lista.`}
              primaryAction={{ label: "Limpiar filtros", onClick: () => { setQuery(""); setFilter("all"); } }} />}
        </section>
        {selected && <ApplicationDetail item={selected} assessment={assessmentFor(selected)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} returnFocus={returnFocus} />}
      </div>}
      {data && (failure || loaded || data.next_cursor) && <ActionBar status={failure ? <ActionStatus id="applications-status" tone="error" text="No pudimos cargar las postulaciones" action={failure.reason === "unauthenticated" ? <Link href="/candidato/ingresar" className="inline-flex min-h-10 items-center underline">Ingresar como candidato</Link> : undefined} /> : loaded ? <ActionStatus id="applications-status" tone="success" text="Postulaciones cargadas" /> : null}>
        {(failure || data?.next_cursor) && <Button variant="outline" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={failure || loaded ? "applications-status" : undefined} onClick={() => void loadMore()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{failure ? "Reintentar" : "Cargar más"}</Button>}
      </ActionBar>}
    </>}
  </DashboardPageContent>;
}
