"use client";
import { useState } from "react";
import { BookOpen, ChevronDown, Columns3, ListFilter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceList } from "@/components/ui/choice-list";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { COLUMN_DEFINITIONS, DEFINITIONS } from "./definitions";
import type { Period } from "./period";
import { isProcessKind, PROCESS_KIND_LABEL, type MetricsFilters } from "./url-state";
import { PeriodControl } from "./recruiter-detail/period-control";
import { COLUMNS } from "./recruiter-columns";
import { COLUMN_GROUPS, COLUMN_IDS, isDefaultView, type ColumnId, type TableView } from "./recruiter-view";
import { SORT_KEYS, type RecruiterSort, type SortKey } from "./sorting";

export const IGNORED_COLUMNS = "«Asignadas» y «Conversión» no cambian con el filtro de proceso.";
const PANEL = "w-[min(420px,calc(100vw-2rem))]";

/** Selector button of the «Filter bar with chips» recipe: the name and a count, never the value (the chip carries it). */
function Selector({ count, label, countLabel, icon: Icon, ...props }: { count: number; label: string; countLabel?: string; icon: typeof ListFilter } & Omit<React.ComponentProps<typeof Button>, "children">) {
  return <Button {...props} type="button" variant="outline" aria-haspopup="dialog" aria-label={countLabel}
    className={cn("min-h-10 gap-2", count > 0 && "border-primary/35 bg-primary/7")}>
    <Icon aria-hidden="true" />{label}
    {count > 0 && <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-4 font-semibold text-primary-foreground dark:bg-primary-text dark:text-card">{count}</span>}
    <ChevronDown aria-hidden="true" />
  </Button>;
}

function ProcessPanel({ filters, onFilters }: { filters: MetricsFilters; onFilters: (next: MetricsFilters) => void }) {
  const [open, setOpen] = useState(false);
  const count = filters.process_kind ? 1 : 0;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Selector icon={ListFilter} label="Proceso" count={count} countLabel={count ? `Proceso · ${count}` : undefined} />} />
    <PopoverContent align="start" className={PANEL}>
      <PopoverTitle className="font-semibold">Proceso</PopoverTitle>
      <ChoiceList legend="Proceso" hideLegend value={filters.process_kind ?? "all"}
        options={[{ value: "all", title: "Todos los procesos" }, { value: "original", title: PROCESS_KIND_LABEL.original, description: "Vacantes abiertas por primera vez" }, { value: "replacement", title: PROCESS_KIND_LABEL.replacement, description: "Vacantes que reemplazan a una anterior" }]}
        onValueChange={value => { onFilters({ ...filters, process_kind: isProcessKind(value) ? value : undefined }); setOpen(false); }} />
      <p className="text-xs text-muted-foreground">{IGNORED_COLUMNS}</p>
    </PopoverContent>
  </Popover>;
}

function ColumnsPanel({ view, onView }: { view: TableView; onView: (next: TableView) => void }) {
  const [open, setOpen] = useState(false);
  const hidden = view.hidden.length;
  const setGroup = (columns: readonly ColumnId[], shown: string[]) => onView({ ...view, hidden: COLUMN_IDS.filter(id => columns.includes(id) ? !shown.includes(id) : view.hidden.includes(id)) });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Selector icon={Columns3} label="Columnas" count={hidden} countLabel={hidden ? `Columnas · ${hidden} ${hidden === 1 ? "oculta" : "ocultas"}` : undefined} />} />
    <PopoverContent align="end" className={cn(PANEL, "max-h-[min(34rem,70dvh)] overflow-y-auto")}>
      <PopoverTitle className="font-semibold">Columnas</PopoverTitle>
      <p role="status" className="text-xs text-muted-foreground">{`${COLUMN_IDS.length - hidden} de ${COLUMN_IDS.length} columnas visibles`}</p>
      <ChoiceList multiple legend="Siempre visible" hideLegend value={["name"]} onValueChange={() => {}}
        options={[{ value: "name", title: "Reclutador", disabled: true, disabledReason: "Siempre visible: identifica a cada persona" }]} />
      {COLUMN_GROUPS.map(group => <ChoiceList key={group.id} multiple legend={group.label} value={group.columns.filter(id => !view.hidden.includes(id))}
        options={group.columns.map(id => ({ value: id, title: COLUMNS[id].label }))} onValueChange={shown => setGroup(group.columns, shown)} />)}
    </PopoverContent>
  </Popover>;
}

/** «Qué mide cada columna»: the definitions, kept out of the headers; they follow the table's column order. */
function DefinitionsSheet() {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" className="min-h-10" aria-haspopup="dialog" onClick={() => setOpen(true)}><BookOpen aria-hidden="true" data-icon="inline-start" />Qué mide cada columna</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader><SheetTitle>Qué mide cada columna</SheetTitle><SheetDescription>Definiciones v1. Cada columna se lee por separado; la tabla no asigna posiciones.</SheetDescription></SheetHeader>
        <dl className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {COLUMN_DEFINITIONS.map(({ column, key }) => <div key={column} className="flex flex-col gap-1">
            <dt className="text-sm font-medium">{`${column} · ${DEFINITIONS[key].title}`}</dt>
            <dd className="text-[13px] leading-relaxed">{DEFINITIONS[key].description}</dd>
            <dd className="text-xs text-muted-foreground">{DEFINITIONS[key].footer}</dd>
          </div>)}
        </dl>
      </SheetContent>
    </Sheet>
  </>;
}

const ORDER_NAME = (key: SortKey) => key === "name" ? "Nombre" : COLUMNS[key].label;
/** Phone: sorting by header is gone with the header, so a labelled selector takes its place (same orders, same URL). */
function OrderSelect({ sort, onSort }: { sort: RecruiterSort; onSort: (next: RecruiterSort) => void }) {
  const options = SORT_KEYS.flatMap((key): { key: SortKey; direction: RecruiterSort["direction"]; text: string }[] => key === "name"
    ? [{ key, direction: "ascending", text: "Nombre · A–Z" }, { key, direction: "descending", text: "Nombre · Z–A" }]
    : [{ key, direction: "descending", text: `${ORDER_NAME(key)} · mayor a menor` }, { key, direction: "ascending", text: `${ORDER_NAME(key)} · menor a mayor` }]);
  return <div className="relative md:hidden">
    <label htmlFor="recruiter-order" className="sr-only">Orden</label>
    <select id="recruiter-order" value={`${sort.key}:${sort.direction}`} onChange={event => { const [key, direction] = event.target.value.split(":"); onSort({ key: key as SortKey, direction: direction as RecruiterSort["direction"] }); }}
      className="h-11 w-full appearance-none rounded-xl border border-input bg-card pr-10 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {options.map(option => <option key={`${option.key}:${option.direction}`} value={`${option.key}:${option.direction}`}>{option.text}</option>)}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
  </div>;
}

/** The page's one toolbar (recipe «Filter bar with chips»): Proceso · period · … · Columnas, reset, definitions. */
export function TableToolbar({ filters, period, today, view, periodError, onFilters, onView }: {
  filters: MetricsFilters; period: Period; today: string; view: TableView; periodError?: string;
  onFilters: (next: MetricsFilters) => void; onView: (next: TableView) => void;
}) {
  return <div role="group" aria-label="Filtros y vista" className="flex flex-col gap-2.5">
    <div className="flex flex-wrap items-center gap-2.5">
      <ProcessPanel filters={filters} onFilters={onFilters} />
      <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
      <PeriodControl period={period} today={today} error={periodError} onChange={next => onFilters({ ...filters, ...next })} />
      <div className="flex flex-wrap items-center gap-2.5 md:ml-auto">
        <ColumnsPanel view={view} onView={onView} />
        <Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Restablecer vista" title="Restablecer vista" disabled={isDefaultView(view)}
          onClick={() => onView({ sort: { key: "name", direction: "ascending" }, hidden: [] })}><RotateCcw aria-hidden="true" /></Button>
        <DefinitionsSheet />
      </div>
    </div>
    <OrderSelect sort={view.sort} onSort={sort => onView({ ...view, sort })} />
  </div>;
}
