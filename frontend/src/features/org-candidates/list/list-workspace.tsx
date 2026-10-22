"use client";
import { useEffect, useState } from "react";
import { LayoutGrid, Search, Table2, Users } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { changeFilters, changeView, parseUrlState, type CandidateFilters } from "../url-state";
import { CandidateResults, CandidateResultsSkeleton, type OpenCandidate } from "./candidate-results";
import { CandidateFiltersBar } from "./candidate-filters";
import { useCandidates } from "./use-candidates";

/** Internal organization pool. Both views consume the same accumulated server page. */
export function OrgCandidatesWorkspace({ onOpenCandidate }: { onOpenCandidate?: OpenCandidate }) {
  const { state, update, page, pending, failure, notice, retry, clearNotice, loadMore } = useCandidates();
  const languages = useLanguageCatalog();
  const [search, setSearch] = useState(state.filters.q ?? "");
  useEffect(() => { setSearch(state.filters.q ?? ""); }, [state.filters.q]);
  useEffect(() => {
    if (search.trim() === (state.filters.q ?? "")) return;
    const timer = setTimeout(() => {
      const current = parseUrlState(new URLSearchParams(window.location.search));
      update(changeFilters(current, { q: search })); clearNotice();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, state.filters.q, update, clearNotice]);
  const patch = (filters: CandidateFilters) => { clearNotice(); update(changeFilters(state, filters)); };
  const clear = () => { setSearch(""); clearNotice(); update({ view: state.view, filters: {} }); };
  const filtered = Object.keys(state.filters).length > 0;
  const initial = pending && !page;
  const filterError = failure?.reason === "invalid_filter";
  const errorDescription = failure?.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo para consultar los candidatos."
    : failure?.reason === "forbidden" ? "Necesitas ser miembro de esta organización para consultar sus candidatos."
    : filterError ? "No pudimos aplicar los filtros. Limpia los filtros para volver a consultar la lista."
    : "No pudimos consultar los candidatos. Puedes volver a intentarlo.";
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <header className="flex flex-col gap-2"><h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">Candidatos de mi organización</h2><p className="max-w-prose text-[13.5px] text-muted-foreground">Las personas que agregaste o que se postularon a las vacantes de tu empresa, con su perfil y sus procesos.</p></header>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <Field className="w-full sm:max-w-sm"><FieldLabel htmlFor="org-candidates-search">Buscar candidatos</FieldLabel><InputGroup className="min-h-10"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput id="org-candidates-search" type="search" value={search} onChange={event => setSearch(Array.from(event.target.value).slice(0, 100).join(""))} placeholder="Buscar por nombre o correo…" /></InputGroup></Field>
      <ToggleGroup aria-label="Vista de candidatos" value={[state.view]} onValueChange={(values: string[]) => { const view = values[0]; if (view === "cards" || view === "table") update(changeView(state, view)); }} variant="outline"><ToggleGroupItem value="table" className="min-h-10"><Table2 aria-hidden="true" />Tabla</ToggleGroupItem><ToggleGroupItem value="cards" className="min-h-10"><LayoutGrid aria-hidden="true" />Tarjetas</ToggleGroupItem></ToggleGroup>
    </div>
    <CandidateFiltersBar filters={state.filters} onChange={patch} onClear={clear} languages={languages.data?.items ?? []} />
    {languages.status === "error" && <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted-foreground">No pudimos cargar el catálogo de idiomas.</p><Button type="button" variant="link" className="min-h-10" onClick={languages.retry}>Reintentar idiomas</Button></div>}
    {notice && <ActionStatus id="org-candidates-notice" tone="info" text={notice} />}
    <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{initial ? <><span className="sr-only">Cargando candidatos</span><Skeleton aria-hidden="true" className="h-5 w-28" /></> : page ? `${page.total} ${page.total === 1 ? "candidato" : "candidatos"}` : null}</div>
    <section aria-label="Resultados de candidatos" aria-busy={pending} className="flex min-w-0 flex-col gap-4">
      {initial ? <CandidateResultsSkeleton view={state.view} /> : <>
        {failure && <StateCard icon={Users} tone={failure.reason === "forbidden" ? "forbidden" : "error"} title={filterError ? "No pudimos aplicar los filtros" : "No pudimos cargar los candidatos"} description={errorDescription} primaryAction={{ label: filterError ? "Limpiar filtros" : "Reintentar", onClick: filterError ? clear : retry }} />}
        {!failure && page && page.items.length === 0 && <StateCard icon={Users} tone="empty" title={filtered ? "Sin resultados" : "Todavía no hay candidatos en tu organización"} description={filtered ? "No hay candidatos que coincidan con estos filtros." : "Agrega un candidato desde el tablero de una vacante para comenzar."} primaryAction={filtered ? { label: "Limpiar filtros", onClick: clear } : undefined} />}
        {!!page?.items.length && <CandidateResults items={page.items} view={state.view} languages={languages.data?.items ?? []} onOpen={onOpenCandidate} />}
        {page?.next_cursor && <div className="flex justify-center"><Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={loadMore}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Cargar más</Button></div>}
      </>}
    </section>
  </DashboardPageContent>;
}
