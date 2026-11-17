"use client";
import { useCallback, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { loadDetailAction } from "../actions";
import { MetricsAccessGate } from "../metrics-page";
import { MetricsFailureCard } from "../metrics-workspace";
import { CHANNEL_LABEL, CLOSE_REASON_LABEL, dayLabel, momentLabel, number, REASSIGNMENT_REASON_LABEL, STAGE_KIND_LABEL, type DetailPage } from "../model";
import { mexicoToday } from "../period";
import { effectivePeriod } from "../url-state";
import { detailColumns, detailTable, type VacancyRef } from "./detail-columns";
import { DetailHeading, FacetSwitch, facetOptions, FilterChipList, Pager, RecordsSkeleton, RecordsTable, rowRange, StalledToggle, useCursorPages, type FacetOption } from "./detail-parts";
import { ExportDetailButton } from "./export-button";
import { boardHref, defaultOrder, detailHref, FACET_PARAM, isListKind, parseDetail, SORTS, withParams, type DetailState, type ListKind } from "./query";
import { detailTitle, figureTitle, filterChips, HELD_LABEL, RESULT_LABEL, summaryLine } from "./titles";

type Role = "owner" | "stakeholder";
const CHANGED = "company-metrics-detail-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}
/** The filters live in the URL (shareable, Back restores them); the cursor is page state and never enters it. */
function useDetailUrl() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const state = useMemo(() => parseDetail(new URLSearchParams(search)), [search]);
  const navigate = useCallback((href: string) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { state, navigate };
}
/** A plain click stays in the page; a modified click (new tab) keeps the browser's default. */
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** One server page of the list at a time (`useCursorPages`); the cursor is page state and never enters the URL. */
function useDetailList(state: DetailState & { kind: ListKind }) {
  const { kind, params } = state;
  return useCursorPages(detailHref(state), cursor => loadDetailAction({ kind, query: params, ...(cursor ? { cursor } : {}) }));
}

/** `/empresa/metricas/detalle`: the role gate first; the role decides where a vacancy opens (v2 §7). */
export function MetricsDetailPage() {
  return <MetricsAccessGate label="Cargando el detalle">{role => <DetailWorkspace role={role} />}</MetricsAccessGate>;
}

function DetailWorkspace({ role }: { role: Role }) {
  const { state, navigate } = useDetailUrl();
  if (!state) return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-6">
    <Card className="p-6"><SectionEmpty icon={SearchX} tone="empty" headingLevel={2} title="No encontramos esta lista"
      description="El enlace no indica qué registros mostrar. Vuelve a Métricas y elige una cifra." primaryAction={{ label: "Volver a Métricas", href: "/empresa/metricas" }} /></Card>
  </DashboardPageContent>;
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-6">
    {isListKind(state.kind) && <ListDetail key={state.kind} state={state as DetailState & { kind: ListKind }} role={role} navigate={navigate} />}
  </DashboardPageContent>;
}

function DetailHeader({ state, title, freshness, actions }: { state: DetailState; title: string; freshness?: string; actions?: ReactNode }) {
  return <DetailHeading back={{ href: boardHref(state), label: "Métricas" }} crumb={figureTitle(state)} title={title} freshness={freshness} actions={actions} />;
}

function ListDetail({ state, role, navigate }: { state: DetailState & { kind: ListKind }; role: Role; navigate: (href: string) => void }) {
  const list = useDetailList(state);
  const [today] = useState(mexicoToday);
  const applied = list.data?.page.applied_filters;
  const period = list.data && !list.stale ? list.data.page.period : effectivePeriod(state.params, today);
  // Candidates are current state (§5.5): the period is echoed but never applied, so it is not shown as their scope.
  const scope = state.kind === "candidates" ? "Foto de hoy; no depende del periodo" : `${dayLabel(period.from)} – ${dayLabel(period.to)}`;
  const freshness = [list.data?.page.as_of && `Actualizado ${momentLabel(list.data.page.as_of)}`, scope,
    list.data && `Definiciones ${list.data.page.definitions_version}`].filter(Boolean).join(" · ");
  const go = (next: DetailState) => navigate(detailHref(next));
  const chips = filterChips(state, applied);
  const facetParam = FACET_PARAM[state.kind];
  const statusFiltered = Boolean(state.params[facetParam]);

  const vacancyHref = (ref: VacancyRef) => role === "owner" ? `/empresa/vacantes/${ref.draft_id}/pipeline`
    : detailHref({ kind: "deliveries", params: { from: period.from, to: period.to, vacancy_id: ref.draft_id }, back: state.back });
  const vacancy = (ref: VacancyRef) => {
    const title = ref.title?.trim() || "Vacante sin título";
    const className = "font-medium text-primary-text underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
    // Owner: the vacancy board. Stakeholder: the same metrics, filtered by the vacancy (v2 §7).
    if (role === "owner") return <Link href={vacancyHref(ref)} className={className}>{title}</Link>;
    const href = vacancyHref(ref);
    return <a href={href} className={className} onClick={event => { if (plainClick(event)) { event.preventDefault(); navigate(href); window.scrollTo?.({ top: 0 }); } }}>{title}</a>;
  };

  return <>
    <DetailHeader state={state} title={detailTitle(state, applied)} freshness={freshness} actions={<ExportDetailButton state={state} />} />
    <FilterChipList chips={chips} onRemove={chip => go(withParams(state, Object.fromEntries(chip.remove.map(key => [key, undefined]))))} />
    <Card className="gap-5 p-6" aria-busy={list.pending || undefined}>
      {list.notice && <p role="status" className="text-sm text-muted-foreground">{list.notice}</p>}
      {list.failure && !list.pending
        ? <MetricsFailureCard failure={list.failure} subject="los registros" onRetry={list.retry} onReset={() => go({ ...state, params: {} })} />
        : !list.data
          ? <DetailSkeleton state={state} />
          : <div className={cn("flex min-w-0 flex-col gap-5 transition-opacity motion-reduce:transition-none", list.stale && "opacity-60")}>
            <p className="text-base" aria-live="polite">{summaryLine(state, list.data).map(([text, bold], index) => bold ? <b key={index} className="font-semibold tabular-nums">{text}</b> : text)}</p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <StatusSwitch state={state} data={list.data} onChange={value => go(withParams(state, { [facetParam]: value }))} />
              {list.data.kind === "candidates" && <StalledToggle pressed={state.params.stalled === "true"} count={list.data.page.facets.stalled}
                onChange={pressed => go(withParams(state, { stalled: pressed ? "true" : undefined }))} />}
            </div>
            {list.data.page.total === 0 || list.data.page.items.length === 0
              ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados"
                description={statusFiltered ? "Ningún registro tiene este estado en el periodo y con estos filtros." : "Ningún registro coincide con estos filtros en el periodo."}
                {...(statusFiltered ? { primaryAction: { label: "Ver todas", onClick: () => go(withParams(state, { [facetParam]: undefined })) } } : {})} />
              : <RecordsTableFor state={state} data={list.data} vacancy={vacancy} onSort={(sort, order) => go(withParams(state, { sort, order }))} />}
            {list.data.page.items.length > 0 && <Pager range={pageRange(list.data, list.first)} hasPrevious={list.hasPrevious} hasNext={list.hasNext} pending={list.pending} onPrevious={list.previous} onNext={list.next} />}
          </div>}
    </Card>
  </>;
}

/** «1–50 de 120»; applications count rows of vacancies while their total sums applications, so they show the rows only. */
function pageRange(data: DetailPage, first: number): string {
  const range = rowRange(first, data.page.items.length);
  return data.kind === "applications" ? `Vacantes ${range}` : `${range} de ${number.format(data.page.total)}`;
}

/** The status switch of each kind, from its facet (each facet ignores only its own filter, so it adds up to «Todas»). */
function statusOptions(state: DetailState, data: DetailPage): { label: string; options: FacetOption[] } | null {
  const withAll = (label: string, all: string, entries: [string, string, number][]) => ({ label, options: facetOptions(all, entries) });
  switch (data.kind) {
    case "deliveries": return withAll("Estado de la entrega", "Todas", Object.entries(data.page.facets.result).map(([key, count]) => [key, RESULT_LABEL[key], count]));
    case "vacancies":
      // The facet counts closed vacancies only; it adds up to the list only when the list is of closed vacancies.
      if (!(state.params.scope === "closed" || state.params.scope === "closed_assigned" || state.params.closed_month)) return null;
      return withAll("Motivo de cierre", "Todas", Object.entries(data.page.facets.close_reason).map(([key, count]) => [key, CLOSE_REASON_LABEL[key as keyof typeof CLOSE_REASON_LABEL], count]));
    case "placements": return withAll("Permanencia", "Todos", [["true", HELD_LABEL.true, data.page.facets.held.true], ["false", HELD_LABEL.false, data.page.facets.held.false]]);
    case "reassignments": return withAll("Motivo", "Todas", Object.entries(data.page.facets.reason).map(([key, count]) => [key, REASSIGNMENT_REASON_LABEL[key as keyof typeof REASSIGNMENT_REASON_LABEL], count]));
    // `retired` arrives only when > 0, so it appears only then.
    case "candidates": return withAll("Etapa", "Todas", Object.entries(data.page.facets.stage_kind).flatMap(([key, count]): [string, string, number][] =>
      count === undefined ? [] : [[key, STAGE_KIND_LABEL[key as keyof typeof STAGE_KIND_LABEL], count]]));
    case "applications": return withAll("Canal", "Todos", Object.entries(data.page.facets.channel).map(([key, count]) => [key, CHANNEL_LABEL[key as keyof typeof CHANNEL_LABEL], count]));
  }
}
function StatusSwitch({ state, data, onChange }: { state: DetailState & { kind: ListKind }; data: DetailPage; onChange: (value: string | undefined) => void }) {
  const status = statusOptions(state, data);
  if (!status) return null;
  return <FacetSwitch label={status.label} options={status.options} selected={state.params[FACET_PARAM[state.kind]]} onChange={onChange} />;
}

function useSort(state: DetailState & { kind: ListKind }) {
  const sort = state.params.sort ?? SORTS[state.kind][0];
  const order = state.params.order ?? defaultOrder(sort);
  return { sort, order: order as "asc" | "desc" };
}
function RecordsTableFor({ state, data, vacancy, onSort }: {
  state: DetailState & { kind: ListKind }; data: DetailPage; vacancy: (ref: VacancyRef) => ReactNode; onSort: (sort: string, order: "asc" | "desc") => void;
}) {
  const { sort, order } = useSort(state);
  return <RecordsTable table={detailTable(state, data, { vacancy })} caption={detailTitle(state, data.page.applied_filters)} sort={sort} order={order} onSort={onSort} />;
}

function DetailSkeleton({ state }: { state: DetailState & { kind: ListKind } }) {
  return <RecordsSkeleton columns={detailColumns(state)} />;
}
