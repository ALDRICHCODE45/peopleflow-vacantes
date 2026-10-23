"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, List, Search, Users } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { changeFilters, changeView, parseUrlState, serializeFilters, type CandidateFilters } from "../url-state";
import { relativeTime } from "../relative-time";
import { CandidateResults, CandidateResultsSkeleton, type OpenCandidate } from "./candidate-results";
import { CandidateFiltersBar } from "./candidate-filters";
import { useCandidates } from "./use-candidates";
import type { OrgCandidateDetail } from "../detail/detail-model";
import { OriginTabs } from "../summary/origin-tabs";
import { SummaryBand } from "../summary/summary-band";
import { useCandidatesSummary } from "../summary/use-candidates-summary";

function UpdatedAt({ value }: { value: string }) {
 const [, tick] = useState(0);
 useEffect(() => { const timer = setInterval(() => tick(previous => previous + 1), 30_000); return () => clearInterval(timer); }, []);
 return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-success" /><time dateTime={value}>Actualizado {relativeTime(value)}</time></span>;
}
/** One v0 content surface; URL/data controller and rich-table preferences remain authoritative. */
export function OrgCandidatesWorkspace({ onOpenCandidate, updatedCandidate }: { onOpenCandidate?: OpenCandidate; updatedCandidate?: OrgCandidateDetail | null }) {
 const { state, update, page, lastLoadedAt, pending, failure, notice, retry, clearNotice, loadMore, patchCandidate } = useCandidates();
 const summary = useCandidatesSummary();
 const refreshSummary = summary.refresh;
 useEffect(() => { if (!updatedCandidate) return; patchCandidate(updatedCandidate); void refreshSummary(); }, [updatedCandidate, patchCandidate, refreshSummary]);
 const languages = useLanguageCatalog();
 const isMobile = useIsMobile();
 const resultView = isMobile ? "cards" : state.view;
 const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(null);
 const searchRef = useRef<HTMLInputElement>(null);
 const [search, setSearch] = useState(state.filters.q ?? "");
 const [shortcut, setShortcut] = useState("Ctrl K");
 useEffect(() => {
  setShortcut(/Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘ K" : "Ctrl K");
  const focusSearch = (event: KeyboardEvent) => {
   if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !document.querySelector('[role="dialog"],[role="alertdialog"]')) {
    event.preventDefault(); searchRef.current?.focus();
   }
  };
  document.addEventListener("keydown", focusSearch);
  return () => document.removeEventListener("keydown", focusSearch);
 }, []);
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
 const fallback = initial ? <CandidateResultsSkeleton view={resultView} /> : !page?.items.length ? <div className="px-(--card-spacing)">
  {failure ? <StateCard icon={Users} tone={failure.reason === "forbidden" ? "forbidden" : "error"} title={filterError ? "No pudimos aplicar los filtros" : "No pudimos cargar los candidatos"} description={errorDescription} primaryAction={{ label: filterError ? "Limpiar filtros" : "Reintentar", onClick: filterError ? clear : retry }} />
   : page ? <StateCard icon={Users} tone="empty" title={filtered ? "Sin resultados" : "Todavía no hay candidatos en tu organización"} description={filtered ? "No hay candidatos que coincidan con estos filtros." : "Agrega un candidato desde el tablero de una vacante para comenzar."} primaryAction={filtered ? { label: "Limpiar filtros", onClick: clear } : undefined} /> : null}
 </div> : undefined;
 return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
  <SummaryBand data={summary.data} pending={summary.pending} failure={summary.failure} onRetry={() => void refreshSummary()} />
  <Card role="region" aria-label="Resultados de candidatos" aria-busy={pending} className="min-w-0 pt-0">
   <OriginTabs value={state.filters.origin === "manual" ? "manual" : "all"} onValueChange={value => patch({ origin: value === "manual" ? "manual" : undefined })} counts={summary.data ? { all: summary.data.total, manual: summary.data.by_kind.manual } : undefined} />
   <CardHeader className="gap-4">
    <CardTitle className="sr-only"><h3>Base de talento</h3></CardTitle>
    <CandidateFiltersBar filters={state.filters} onChange={patch} onClear={clear} languages={languages.data?.items ?? []}
     search={<Field className="w-full min-w-0 md:max-w-sm md:flex-1"><FieldLabel htmlFor="org-candidates-search" className="sr-only">Buscar candidatos</FieldLabel><InputGroup className="min-h-10"><InputGroupInput ref={searchRef} id="org-candidates-search" type="search" aria-keyshortcuts="Meta+K Control+K" value={search} onChange={event => setSearch(Array.from(event.target.value).slice(0, 100).join(""))} placeholder="Buscar por nombre o correo…" /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupAddon align="inline-end"><kbd className="whitespace-nowrap rounded border px-1 text-[10px]">{shortcut}</kbd></InputGroupAddon></InputGroup></Field>}
     viewToggle={<div className="flex min-w-0 items-center gap-2"><div ref={setTableToolbar} /><ToggleGroup aria-label="Vista de candidatos" value={[state.view]} onValueChange={(values: string[]) => { const view = values[0]; if (view === "cards" || view === "table") update(changeView(state, view)); }} variant="outline" size="sm" spacing={0} className="hidden md:flex">
      <ToggleGroupItem value="table" aria-label="Tabla" className="aria-pressed:border-foreground/30 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"><List aria-hidden="true" /></ToggleGroupItem>
      <ToggleGroupItem value="cards" aria-label="Tarjetas" className="aria-pressed:border-foreground/30 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"><LayoutGrid aria-hidden="true" /></ToggleGroupItem>
     </ToggleGroup></div>} />
    <CardDescription className="flex flex-wrap items-center justify-between gap-2 text-xs"><span role="status" aria-live="polite">{initial ? <><span className="sr-only">Cargando candidatos</span><Skeleton aria-hidden="true" className="h-4 w-52" /></> : page ? <><strong className="font-medium text-foreground">{page.total}</strong> {page.total === 1 ? "candidato" : "candidatos"} en tu base de talento</> : null}</span>{lastLoadedAt && <UpdatedAt value={lastLoadedAt} />}</CardDescription>
   </CardHeader>
   {/* Edge-to-edge content follows CardContentEdgeToEdge; candidate cards and
       StateCard retain their own entity/state composition inside the v0 surface. */}
   <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)">
    <div className="flex min-w-0 flex-col gap-4">
     {languages.status === "error" && <div className="flex flex-wrap items-center gap-2 px-(--card-spacing)"><p className="text-xs text-muted-foreground">No pudimos cargar el catálogo de idiomas.</p><Button type="button" variant="link" className="min-h-10" onClick={languages.retry}>Reintentar idiomas</Button></div>}
     {notice && <div className="px-(--card-spacing)"><ActionStatus id="org-candidates-notice" tone="info" text={notice} /></div>}
     {failure && !!page?.items.length && <div className="px-(--card-spacing)"><StateCard icon={Users} tone="error" title="No pudimos cargar los candidatos" description={errorDescription} primaryAction={{ label: filterError ? "Limpiar filtros" : "Reintentar", onClick: filterError ? clear : retry }} /></div>}
     <CandidateResults items={page?.items ?? []} view={resultView} languages={languages.data?.items ?? []} onOpen={onOpenCandidate} selectionKey={JSON.stringify([search, serializeFilters(state.filters).toString()])} fallback={fallback} toolbar={controls => tableToolbar ? createPortal(controls, tableToolbar) : null} />
    </div>
   </CardContent>
   <CardFooter className="flex flex-wrap justify-between gap-3 border-t"><span className="text-xs text-muted-foreground">{page ? `Mostrando ${page.items.length} de ${page.total} ${page.total === 1 ? "candidato" : "candidatos"}` : ""}</span>{page?.next_cursor && <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={loadMore}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Cargar más</Button>}</CardFooter>
  </Card>
 </DashboardPageContent>;
}
