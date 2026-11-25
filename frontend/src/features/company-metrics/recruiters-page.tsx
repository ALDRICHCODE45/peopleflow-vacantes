"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SearchX, Users, X } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadRecruitersAction } from "./actions";
import { boardPath, drilldownHref } from "./drilldown";
import { fieldErrors } from "./failure";
import { audienceChips, type RecruiterOption } from "./metrics-filters";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsFailureCard } from "./metrics-workspace";
import type { RecruiterCard } from "./model";
import { mexicoToday, periodLabel } from "./period";
import { ProcessNote } from "./process-kind";
import { COLUMNS } from "./recruiter-columns";
import { RecruiterTable } from "./recruiter-table";
import { IGNORED_COLUMNS, TableToolbar } from "./recruiter-toolbar";
import { COLUMN_IDS, parseTableView, recruiterFromTable, serializeTableView, tablePath, type TableView } from "./recruiter-view";
import { sortLabel, sortRecruiters, nextSort, type SortKey } from "./sorting";
import { effectivePeriod, serializeFilters, type MetricsFilters } from "./url-state";
import { useMetricsUrl } from "./use-metrics-url";
import { useSection } from "./use-section";

/** Params a period or filter change keeps: the table's own view. */
const VIEW_PARAMS = ["sort", "hide"];

function Chips({ chips, onRemove, onClear }: { chips: { key: string; label: string }[]; onRemove: (key: string) => void; onClear: () => void }) {
  if (chips.length === 0) return null;
  return <div role="group" aria-label="Filtros activos" className="flex min-w-0 flex-wrap items-center gap-2">
    {chips.map(chip => {
      const [name, ...value] = chip.label.split(": ");
      return <span key={chip.key} data-slot="metrics-chip" className="inline-flex max-w-full items-start rounded-xl bg-card pl-3 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
        <span className="min-w-0 py-2.5 pr-1 [overflow-wrap:anywhere]">{value.length ? <><span className="text-muted-foreground">{`${name}:`}</span>{" "}<b className="font-medium">{value.join(": ")}</b></> : <b className="font-medium">{name}</b>}</span>
        <Button type="button" variant="ghost" size="icon" title="Quitar" aria-label={`Quitar filtro ${chip.label}`} className="size-10 shrink-0 rounded-xl text-muted-foreground" onClick={() => onRemove(chip.key)}><X aria-hidden="true" /></Button>
      </span>;
    })}
    <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>
  </div>;
}

/** Rule 15: the real headers over skeleton rows, so the page does not jump when the answer arrives. */
function TableSkeleton({ view }: { view: TableView }) {
  const columns = COLUMN_IDS.filter(id => !view.hidden.includes(id));
  return <div role="status" aria-label="Cargando desempeño por reclutador" aria-busy="true">
    <Card aria-hidden="true" className="hidden gap-0 overflow-hidden p-0 md:flex">
      <table className="w-full table-fixed text-sm">
        <thead><tr className="border-b text-muted-foreground"><th scope="col" className="h-10 w-46 px-4 text-left font-medium">Reclutador</th>
          {columns.map(id => <th key={id} scope="col" className="h-10 px-2 text-right font-medium">{COLUMNS[id].label}</th>)}</tr></thead>
        <tbody>{[0, 1, 2, 3, 4, 5].map(row => <tr key={row} className="h-[86px] border-b last:border-0">
          <td className="px-4"><div className="flex gap-3"><Skeleton className="size-10 rounded-full" /><div className="grid gap-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></td>
          {columns.map(id => <td key={id} className="px-2"><div className="grid justify-items-end gap-2"><Skeleton className="h-3.5 w-14" /><Skeleton className="h-3 w-[72px]" /></div></td>)}</tr>)}</tbody>
      </table>
    </Card>
    <Card aria-hidden="true" className="gap-4 p-4 md:hidden">{[0, 1, 2].map(row => <div key={row} className="grid gap-3"><div className="flex gap-3"><Skeleton className="size-10 rounded-full" /><Skeleton className="h-4 w-36" /></div><Skeleton className="h-11 w-full" /><Skeleton className="h-9 w-full" /></div>)}</Card>
  </div>;
}

function RecruitersWorkspace() {
  const { filters, key, search, update, write } = useMetricsUrl(VIEW_PARAMS);
  const [today] = useState(mexicoToday);
  const view = useMemo(() => parseTableView(new URLSearchParams(search)), [search]);
  const state = useSection(loadRecruitersAction, filters, key);
  const period = effectivePeriod(filters, today);
  const scope: MetricsFilters = { ...filters, ...period };
  const known = useRef(new Map<string, RecruiterOption>());
  for (const card of state.data ?? []) known.current.set(card.user_id, { user_id: card.user_id, name: card.name, former_member: card.former_member });
  const chips = audienceChips(filters, [...known.current.values()], []);
  const narrowed = chips.length > 0;

  // The table's own view replaces the URL entry (sorting is not a navigation); filters and period push, so Back restores them.
  const setView = useCallback((next: TableView) => {
    const params = serializeFilters(filters);
    for (const [name, value] of serializeTableView(next)) params.set(name, value);
    write(params, "replace");
  }, [filters, write]);
  const onSort = (column: SortKey) => setView({ ...view, sort: nextSort(view.sort, column) });
  const remove = (chip: string) => update(chip === "recruiter" ? { ...filters, recruiter_id: undefined } : chip === "process" ? { ...filters, process_kind: undefined } : { ...filters, requester_kind: undefined, requester_id: undefined });
  const clear = () => update({ from: filters.from, to: filters.to });

  const failure = state.status === "failed" ? state.failure : null;
  const data = failure ? null : state.data;
  const items: RecruiterCard[] = useMemo(() => sortRecruiters(data ?? [], view.sort), [data, view.sort]);
  const periodError = failure?.reason === "invalid_filter" ? (({ from, to }) => from ?? to)(fieldErrors(failure.fields)) : undefined;
  const freshness = [periodLabel(period), filters.process_kind && `Solo ${filters.process_kind === "replacement" ? "reemplazos" : "originales"}`].filter(Boolean).join(" · ");
  const back = `${boardPath(scope)}`;

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <div className="flex flex-col gap-4">
      <nav aria-label="Ruta" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={back} className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-primary-text outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft aria-hidden="true" className="size-4" />Métricas
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5" />
        <span aria-current="page" className="min-w-0 font-medium text-foreground">Desempeño por reclutador</span>
      </nav>
      <header className="flex max-w-3xl min-w-0 flex-col gap-1">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Desempeño por reclutador</h2>
        <p className="text-sm text-muted-foreground">Sin puntaje ni posición: cada columna se lee por separado y la comparación la haces tú.</p>
        <p className="text-xs text-muted-foreground">{freshness}</p>
      </header>
    </div>
    <TableToolbar filters={filters} period={period} today={today} view={view} periodError={periodError} onFilters={update} onView={setView} />
    <Chips chips={chips} onRemove={remove} onClear={clear} />
    <ProcessNote filters={filters}>{IGNORED_COLUMNS}</ProcessNote>
    {failure ? <MetricsFailureCard failure={failure} subject="el desempeño por reclutador" onRetry={state.retry} onReset={() => update({})} />
      : data === null ? <TableSkeleton view={view} />
        : data.length === 0 ? <Card className="p-6">{narrowed
          ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados" description="Ninguna persona tiene actividad con los filtros elegidos en este periodo. Tus filtros siguen aplicados." primaryAction={{ label: "Limpiar filtros", onClick: clear }} />
          : <SectionEmpty icon={Users} tone="empty" title="Aún no hay reclutadores con actividad en este periodo" description="Aquí verás la comparación por persona cuando tengan vacantes asignadas." />}</Card>
          : <div className="flex min-w-0 flex-col gap-3">
            <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span><b className="font-semibold">{data.length}</b>{` ${data.length === 1 ? "persona" : "personas"} con tramos en el periodo`}</span>
              <span aria-hidden="true" className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{sortLabel(view.sort)}</span>
            </p>
            <div className={state.stale ? "min-w-0 opacity-60 transition-opacity motion-reduce:transition-none" : "min-w-0 transition-opacity motion-reduce:transition-none"}>
              <RecruiterTable items={items} sort={view.sort} hidden={view.hidden} onSort={onSort}
                href={card => recruiterFromTable(card.user_id, scope, view)}
                drill={(target, count) => drilldownHref(target, scope, { count, back: tablePath(scope, view) })} />
            </div>
          </div>}
    <p className="max-w-3xl text-xs text-muted-foreground">Ordenar acomoda las filas; no asigna posiciones. «Sin datos suficientes» significa que no hubo muestra en el periodo, no un cero, y esas filas van al final. Placements: dir. = crédito directo, part. = participación, comp. = compartido.</p>
  </DashboardPageContent>;
}

/** `/empresa/metricas/reclutadores` (S2): the role gate of Métricas first, then the full recruiter table. */
export function RecruitersPage() {
  return <MetricsAccessGate label="Cargando la tabla de reclutadores"><RecruitersWorkspace /></MetricsAccessGate>;
}
