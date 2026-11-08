"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronsUpDown, SearchX, X } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { loadDetailAction } from "../actions";
import { DETAIL_PATH } from "../drilldown";
import { MetricsAccessGate } from "../metrics-page";
import { MetricsFailureCard } from "../metrics-workspace";
import { CHANNEL_LABEL, CLOSE_REASON_LABEL, dayLabel, momentLabel, number, REASSIGNMENT_REASON_LABEL, STAGE_KIND_LABEL, type DetailPage, type MetricsFailure } from "../model";
import { mexicoToday } from "../period";
import { effectivePeriod } from "../url-state";
import { detailColumns, detailTable, type Column, type VacancyRef } from "./detail-columns";
import { ExportDetailButton } from "./export-button";
import { boardHref, defaultOrder, detailHref, FACET_PARAM, isListKind, parseDetail, SORTS, withParams, type DetailState, type ListKind } from "./query";
import { detailTitle, figureTitle, filterChips, HELD_LABEL, RESULT_LABEL, summaryLine } from "./titles";

type Role = "owner" | "stakeholder";
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };
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

type Loaded = { key: string; data: DetailPage };
/**
 * One server page at a time (rule 17): new filters start again from the first page and keep the last rows dimmed until
 * the answer arrives; «Siguiente» follows `next_cursor`, «Anterior» goes back to the cursor before. A stale cursor
 * restarts from the first page with a notice.
 */
function useDetailList(state: DetailState & { kind: ListKind }) {
  const key = detailHref(state);
  const [pages, setPages] = useState<{ key: string; cursors: string[]; offsets: number[] }>({ key, cursors: [], offsets: [] });
  const current = pages.key === key ? pages : { key, cursors: [], offsets: [] };
  const cursor = current.cursors.at(-1);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<MetricsFailure | null>(null);
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const { kind, params } = state;
  useEffect(() => {
    let active = true;
    setPending(true); setFailure(null);
    void loadDetailAction({ kind, query: params, ...(cursor ? { cursor } : {}) }).catch(() => noResponse).then(result => {
      if (!active) return;
      setPending(false);
      if (result.ok) { setLoaded({ key, data: result.data }); return; }
      if (result.reason === "invalid_cursor" && cursor) { setNotice("La lista se actualizó. Volvimos a la primera página."); setPages({ key, cursors: [], offsets: [] }); return; }
      setFailure(result);
    });
    return () => { active = false; };
  }, [key, cursor, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = loaded?.data;
  return {
    data: shown ?? null, stale: pending || loaded?.key !== key, pending, failure, notice,
    first: current.offsets.reduce((sum, value) => sum + value, 0) + 1,
    hasPrevious: current.cursors.length > 0,
    hasNext: Boolean(!pending && loaded?.key === key && shown?.page.next_cursor),
    next: () => { if (shown?.page.next_cursor) { setNotice(null); setPages({ key, cursors: [...current.cursors, shown.page.next_cursor], offsets: [...current.offsets, shown.page.items.length] }); } },
    previous: () => { setNotice(null); setPages({ key, cursors: current.cursors.slice(0, -1), offsets: current.offsets.slice(0, -1) }); },
    retry: () => setAttempt(value => value + 1),
  };
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
  return <div className="flex flex-col gap-2">
    <nav aria-label="Ruta" className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link href={boardHref(state)} className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft aria-hidden="true" className="size-4" />Métricas
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page" className="font-medium text-foreground">{figureTitle(state)}</span>
    </nav>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">{title}</h2>
        {freshness && <p className="text-xs text-muted-foreground">{freshness}</p>}
      </div>
      {actions}
    </header>
  </div>;
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
    : `${DETAIL_PATH}?${new URLSearchParams({ kind: "deliveries", from: period.from, to: period.to, vacancy_id: ref.draft_id })}`;
  const vacancy = (ref: VacancyRef) => {
    const title = ref.title?.trim() || "Vacante sin título";
    const className = "font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
    // Owner: the vacancy board. Stakeholder: the same metrics, filtered by the vacancy (v2 §7).
    if (role === "owner") return <Link href={vacancyHref(ref)} className={className}>{title}</Link>;
    const href = vacancyHref(ref);
    return <a href={href} className={className} onClick={event => { if (plainClick(event)) { event.preventDefault(); navigate(href); window.scrollTo?.({ top: 0 }); } }}>{title}</a>;
  };

  return <>
    <DetailHeader state={state} title={detailTitle(state, applied)} freshness={freshness} actions={<ExportDetailButton state={state} />} />
    {chips.length > 0 && <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
      {chips.map(chip => <li key={chip.key} className="flex h-8 items-center gap-0.5 rounded-full border bg-card pr-1 pl-3 text-sm">
        {chip.label}
        <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground" aria-label={`Quitar filtro ${chip.label}`}
          onClick={() => go(withParams(state, Object.fromEntries(chip.remove.map(key => [key, undefined]))))}>
          <X aria-hidden="true" />
        </Button>
      </li>)}
    </ul>}
    <Card className="gap-5 p-6" aria-busy={list.pending || undefined}>
      {list.notice && <p role="status" className="text-sm text-muted-foreground">{list.notice}</p>}
      {list.failure && !list.pending
        ? <MetricsFailureCard failure={list.failure} subject="los registros" onRetry={list.retry} onReset={() => go({ kind: state.kind, params: {} })} />
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
              : <RecordsTable state={state} data={list.data} vacancy={vacancy} onSort={(sort, order) => go(withParams(state, { sort, order }))} />}
            {list.data.page.items.length > 0 && <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-muted-foreground">
              <span className="tabular-nums">{pageRange(list.data, list.first)}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!list.hasPrevious || list.pending} onClick={list.previous}>Anterior</Button>
                <Button type="button" variant="outline" size="sm" disabled={!list.hasNext} onClick={list.next}>Siguiente</Button>
              </div>
            </div>}
          </div>}
    </Card>
  </>;
}

/** «1–50 de 120»; applications count rows of vacancies while their total sums applications, so they show the rows only. */
function pageRange(data: DetailPage, first: number): string {
  const range = `${number.format(first)}–${number.format(first + data.page.items.length - 1)}`;
  return data.kind === "applications" ? `Vacantes ${range}` : `${range} de ${number.format(data.page.total)}`;
}

/** «Solo detenidos» (§5.5 `stalled=true`); its count ignores only this filter. */
function StalledToggle({ pressed, count, onChange }: { pressed: boolean; count: number; onChange: (pressed: boolean) => void }) {
  return <Button type="button" variant="outline" aria-pressed={pressed} onClick={() => onChange(!pressed)}
    className={cn("min-h-10 gap-1 px-3 text-muted-foreground", pressed && "border-destructive/30 bg-destructive/10 font-semibold text-destructive hover:bg-destructive/15 hover:text-destructive")}>
    Solo detenidos{" "}<span className="font-medium tabular-nums">{number.format(count)}</span>
  </Button>;
}

type Option = { value: string | undefined; label: string; count: number };
/** The status switch of each kind, from its facet (each facet ignores only its own filter, so it adds up to «Todas»). */
function statusOptions(state: DetailState, data: DetailPage): { label: string; options: Option[] } | null {
  const withAll = (label: string, all: string, entries: [string, string, number][]) => ({
    label, options: [{ value: undefined, label: all, count: entries.reduce((sum, [, , count]) => sum + count, 0) }, ...entries.map(([value, text, count]) => ({ value, label: text, count }))],
  });
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
  const selected = state.params[FACET_PARAM[state.kind]];
  return <div role="group" aria-label={status.label} className="flex flex-wrap rounded-xl border bg-card p-0.5">
    {status.options.map(option => {
      const pressed = option.value === selected;
      return <Button key={option.label} type="button" variant="ghost" aria-pressed={pressed} onClick={() => onChange(option.value)}
        className={cn("min-h-10 rounded-lg px-3 text-muted-foreground", pressed && "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary")}>
        {option.label}{" "}<span className="font-medium tabular-nums text-muted-foreground">{number.format(option.count)}</span>
      </Button>;
    })}
  </div>;
}

function useSort(state: DetailState & { kind: ListKind }) {
  const sort = state.params.sort ?? SORTS[state.kind][0];
  const order = state.params.order ?? defaultOrder(sort);
  return { sort, order: order as "asc" | "desc" };
}
function RecordsTable({ state, data, vacancy, onSort }: {
  state: DetailState & { kind: ListKind }; data: DetailPage; vacancy: (ref: VacancyRef) => ReactNode; onSort: (sort: string, order: "asc" | "desc") => void;
}) {
  const { sort, order } = useSort(state);
  const table = detailTable(state, data, { vacancy });
  const sortedColumn = table.columns.find(column => column.sort === sort);
  return <div className="flex min-w-0 flex-col gap-2">
    {sortedColumn && <p className="text-xs text-muted-foreground">{`Fechas en hora del centro de México · ordenado por ${sortedColumn.header.toLowerCase()}, ${order === "asc" ? "ascendente" : "descendente"}`}</p>}
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{detailTitle(state, data.page.applied_filters)}</TableCaption>
        <Headers columns={table.columns} sort={sort} order={order} onSort={onSort} />
        <TableBody>{table.rows.map(row => <TableRow key={row.id}>
          {row.cells.map((cell, index) => <TableCell key={table.columns[index].id} className={cn("h-14 whitespace-nowrap", table.columns[index].numeric && "text-right tabular-nums")}>{cell}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </div>;
}
function Headers({ columns, sort, order, onSort }: { columns: Column<never>[]; sort?: string; order?: "asc" | "desc"; onSort?: (sort: string, order: "asc" | "desc") => void }) {
  return <TableHeader><TableRow>{columns.map(column => {
    const active = Boolean(column.sort) && column.sort === sort;
    const Icon = !active ? ChevronsUpDown : order === "asc" ? ArrowUp : ArrowDown;
    return <TableHead key={column.id} scope="col" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined} className={cn("h-11", column.numeric && "text-right")}>
      {column.sort && onSort
        ? <Button type="button" variant="ghost" size="sm" className={cn("-mx-2 h-8 gap-1 px-2 text-xs font-medium", active ? "text-foreground" : "text-muted-foreground", column.numeric && "flex-row-reverse")}
          onClick={() => onSort(column.sort!, active ? (order === "asc" ? "desc" : "asc") : defaultOrder(column.sort!))}>
          {column.header}<Icon aria-hidden="true" className="size-3.5" />
        </Button>
        : <span className="text-xs font-medium text-muted-foreground">{column.header}</span>}
    </TableHead>;
  })}</TableRow></TableHeader>;
}

/** Rule 15: the skeleton mirrors the table (its real headers, four rows). */
function DetailSkeleton({ state }: { state: DetailState & { kind: ListKind } }) {
  const columns = detailColumns(state);
  return <div role="status" aria-label="Cargando los registros" className="flex flex-col gap-5">
    <Skeleton aria-hidden="true" className="h-4 w-full max-w-lg" />
    <Skeleton aria-hidden="true" className="h-10 w-full max-w-xl" />
    <Table aria-hidden="true">
      <Headers columns={columns} />
      <TableBody>{[0, 1, 2, 3].map(row => <TableRow key={row}>{columns.map(column => <TableCell key={column.id} className="h-14">
        <Skeleton className={cn("h-3", column.numeric ? "ml-auto w-12" : "w-28")} />
      </TableCell>)}</TableRow>)}</TableBody>
    </Table>
  </div>;
}
