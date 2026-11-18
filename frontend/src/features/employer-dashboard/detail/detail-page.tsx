"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Card } from "@/components/ui/card";
import { CHANNEL_LABEL, number, STAGE_KIND_LABEL, type MetricsResult, type StageKind } from "@/features/company-metrics/model";
import { MetricsFailureCard } from "@/features/company-metrics/metrics-workspace";
import type { VacancyRef } from "@/features/company-metrics/detail/detail-columns";
import {
  DetailHeading, FacetSwitch, facetOptions, FilterChipList, Pager, RecordsSkeleton, RecordsTable, rowRange, StalledToggle, useCursorPages, defaultOrder,
  type FacetOption,
} from "@/features/company-metrics/detail/detail-parts";
import { cn } from "@/lib/utils";
import { listDashboardApplicationsAction, listDashboardCandidatesAction, listDashboardDeliveriesAction, listDashboardVacanciesAction } from "../actions";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { AccessCard } from "../workspace";
import { dashboardColumns, dashboardTable } from "./columns";
import { ExportDashboardButton } from "./export-button";
import type { DashboardDetailPage as DetailPage } from "./model";
import { boardHref, detailHref, FACET_PARAM, ORGANIC_CHANNELS, parseDashboardDetail, SORTS, withParams, type DashboardDetailState } from "./query";
import { detailTitle, figureTitle, filterChips, freshnessLine, STATE_LABEL, STATUS_LABEL, summaryLine } from "./titles";

const CHANGED = "employer-dashboard-detail-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}
/** The filters and the window live in the URL (shareable, Back restores them); the cursor is page state and never enters it. */
function useDetailUrl() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const state = useMemo(() => parseDashboardDetail(new URLSearchParams(search)), [search]);
  const navigate = useCallback((href: string) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { state, navigate };
}

/** One Server Action per list (contract §5); the window travels with every page. */
function loadPage(state: DashboardDetailState, cursor?: string): Promise<MetricsResult<DetailPage>> {
  const input = { window: state.window, query: state.params, ...(cursor ? { cursor } : {}) };
  switch (state.kind) {
    case "candidates": return listDashboardCandidatesAction(input);
    case "deliveries": return listDashboardDeliveriesAction(input);
    case "vacancies": return listDashboardVacanciesAction(input);
    case "applications": return listDashboardApplicationsAction(input);
  }
}

/**
 * `/empresa/dashboard/detalle`: the records behind a dashboard figure (`design/system.md` rule 16) with the anatomy of
 * the «Métricas» detail page. The API forces the scope by role (owner: the company; recruiter: own vacancies) and
 * answers a stakeholder 403, so the page needs no role of its own: every vacancy opens its board.
 */
export function DashboardDetailPage() {
  const { state, navigate } = useDetailUrl();
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-6">
    {state ? <ListDetail key={state.kind} state={state} navigate={navigate} />
      : <Card className="p-6"><SectionEmpty icon={SearchX} tone="empty" headingLevel={2} title="No encontramos esta lista"
        description="El enlace no indica qué registros mostrar. Vuelve al dashboard y elige una cifra." primaryAction={{ label: "Volver al dashboard", href: "/empresa/dashboard" }} /></Card>}
  </DashboardPageContent>;
}

const vacancyLink = (ref: VacancyRef) => <Link href={vacancyPipelineHref(ref.draft_id)}
  className="rounded-sm font-medium text-primary-text underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring">
  {ref.title?.trim() || "Vacante sin título"}
</Link>;

/** The status switch of each kind, from its facet (each facet ignores only its own filter, so it adds up to «Todas»). */
function statusOptions(data: DetailPage): { label: string; options: FacetOption[] } {
  switch (data.kind) {
    // `retired` arrives only when > 0, so it appears only then.
    case "candidates": return { label: "Etapa", options: facetOptions("Todas", Object.entries(data.page.facets.stage_kind).flatMap(([key, count]): [string, string, number][] =>
      count === undefined ? [] : [[key, STAGE_KIND_LABEL[key as StageKind], count]])) };
    case "deliveries": return { label: "Estado de la entrega", options: facetOptions("Todas", Object.entries(data.page.facets.state).map(([key, count]) => [key, STATE_LABEL[key], count])) };
    case "vacancies": {
      // Only the published vacancies can be asked for (§3.1); «Todas» still counts every status.
      const { published } = data.page.facets.status;
      const all = Object.values(data.page.facets.status).reduce((sum, count) => sum + count, 0);
      return { label: "Estado de la vacante", options: [{ value: undefined, label: "Todas", count: all }, { value: "published", label: STATUS_LABEL.published, count: published }] };
    }
    case "applications": {
      // The board's «Orgánicas» opens every channel but manual, so it is a choice of its own (selected, like the others).
      const { channel } = data.page.facets;
      const [all, ...each] = facetOptions("Todos", Object.entries(channel).map(([key, count]) => [key, CHANNEL_LABEL[key as keyof typeof CHANNEL_LABEL], count]));
      return { label: "Canal", options: [all, { value: ORGANIC_CHANNELS, label: "Orgánicas", count: channel.portal + channel.careers_site + channel.unknown }, ...each] };
    }
  }
}

/** «1–50 de 120»; applications count rows of vacancies while their total sums applications, so they show the rows only. */
function pageRange(data: DetailPage, first: number): string {
  const range = rowRange(first, data.page.items.length);
  return data.kind === "applications" ? `Vacantes ${range}` : `${range} de ${number.format(data.page.total)}`;
}

function ListDetail({ state, navigate }: { state: DashboardDetailState; navigate: (href: string) => void }) {
  const list = useCursorPages(detailHref(state), cursor => loadPage(state, cursor));
  const data = list.data;
  const applied = data?.page.applied_filters;
  const go = (next: DashboardDetailState) => navigate(detailHref(next));
  const facetParam = FACET_PARAM[state.kind];
  const statusFiltered = Boolean(state.params[facetParam]);
  const sort = state.params.sort ?? SORTS[state.kind][0];
  const order = (state.params.order ?? defaultOrder(sort)) as "asc" | "desc";
  const title = detailTitle(state, applied);
  const status = data ? statusOptions(data) : null;

  return <>
    <DetailHeading back={{ href: boardHref(state), label: "Dashboard" }} crumb={figureTitle(state)} title={title}
      freshness={freshnessLine(state, data && !list.stale ? data.page : null)} actions={<ExportDashboardButton state={state} />} />
    <FilterChipList chips={filterChips(state, applied)} onRemove={chip => go(withParams(state, Object.fromEntries(chip.remove.map(key => [key, undefined]))))} />
    <Card className="gap-5 p-6" aria-busy={list.pending || undefined}>
      {list.notice && <p role="status" className="text-sm text-muted-foreground">{list.notice}</p>}
      {list.failure && !list.pending
        ? list.failure.reason === "forbidden"
          ? <AccessCard failure={list.failure} />
          : <MetricsFailureCard failure={list.failure} subject="los registros" onRetry={list.retry} onReset={() => go({ kind: state.kind, window: state.window, params: {} })} />
        : !data
          ? <RecordsSkeleton columns={dashboardColumns(state)} />
          : <div className={cn("flex min-w-0 flex-col gap-5 transition-opacity motion-reduce:transition-none", list.stale && "opacity-60")}>
            <p className="text-base" aria-live="polite">{summaryLine(state, data).map(([text, bold], index) => bold ? <b key={index} className="font-semibold tabular-nums">{text}</b> : text)}</p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              {status && <FacetSwitch label={status.label} options={status.options} selected={state.params[facetParam]} onChange={value => go(withParams(state, { [facetParam]: value }))} />}
              {data.kind === "candidates" && <StalledToggle pressed={state.params.stalled === "true"} count={data.page.facets.stalled}
                onChange={pressed => go(withParams(state, { stalled: pressed ? "true" : undefined }))} />}
            </div>
            {data.page.total === 0 || data.page.items.length === 0
              ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados"
                description={statusFiltered ? "Ningún registro tiene este estado con estos filtros." : "Ningún registro coincide con estos filtros."}
                {...(statusFiltered ? { primaryAction: { label: "Ver todas", onClick: () => go(withParams(state, { [facetParam]: undefined })) } } : {})} />
              : <RecordsTable table={dashboardTable(state, data, { vacancy: vacancyLink })} caption={title} sort={sort} order={order}
                onSort={(nextSort, nextOrder) => go(withParams(state, { sort: nextSort, order: nextOrder }))} />}
            {data.page.items.length > 0 && <Pager range={pageRange(data, list.first)} hasPrevious={list.hasPrevious} hasNext={list.hasNext} pending={list.pending} onPrevious={list.previous} onNext={list.next} />}
          </div>}
    </Card>
  </>;
}
