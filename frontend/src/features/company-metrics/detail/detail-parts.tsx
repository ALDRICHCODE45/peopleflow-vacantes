"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { number, type MetricsFailure, type MetricsResult } from "../model";
import type { Column, Table as RecordsTableData } from "./detail-columns";

/**
 * The anatomy of a detail page (artboard 08), shared by «Métricas» and the company dashboard: breadcrumb and title,
 * removable chips, status switch, sortable table, skeleton and cursor pager. Each page owns its query and its words.
 */
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

type Loaded<T> = { key: string; data: T };
/**
 * One server page at a time (rule 17): new filters (a new `key`) start again from the first page and keep the last rows
 * dimmed until the answer arrives; «Siguiente» follows `next_cursor`, «Anterior» goes back to the cursor before. A stale
 * cursor restarts from the first page with a notice.
 */
export function useCursorPages<T extends { page: { items: unknown[]; next_cursor: string | null } }>(key: string, load: (cursor?: string) => Promise<MetricsResult<T>>) {
  const [pages, setPages] = useState<{ key: string; cursors: string[]; offsets: number[] }>({ key, cursors: [], offsets: [] });
  const current = pages.key === key ? pages : { key, cursors: [], offsets: [] };
  const cursor = current.cursors.at(-1);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [failure, setFailure] = useState<MetricsFailure | null>(null);
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPending(true); setFailure(null);
    void load(cursor).catch(() => noResponse).then(result => {
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

/** Breadcrumb back to the board, the figure's title, its freshness line and the page actions. */
export function DetailHeading({ back, crumb, title, freshness, actions }: { back: { href: string; label: string }; crumb: string; title: string; freshness?: string; actions?: ReactNode }) {
  return <div className="flex flex-col gap-2">
    <nav aria-label="Ruta" className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link href={back.href} className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft aria-hidden="true" className="size-4" />{back.label}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page" className="font-medium text-foreground">{crumb}</span>
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

export type FilterChip = { key: string; label: string; remove: string[] };
/** One removable chip per active filter. */
export function FilterChipList({ chips, onRemove }: { chips: FilterChip[]; onRemove: (chip: FilterChip) => void }) {
  if (chips.length === 0) return null;
  return <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
    {chips.map(chip => <li key={chip.key} className="flex h-8 items-center gap-0.5 rounded-full border bg-card pr-1 pl-3 text-sm">
      {chip.label}
      <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground" aria-label={`Quitar filtro ${chip.label}`} onClick={() => onRemove(chip)}>
        <X aria-hidden="true" />
      </Button>
    </li>)}
  </ul>;
}

/** «Solo detenidos» (`stalled=true`); its count ignores only this filter. */
export function StalledToggle({ pressed, count, onChange }: { pressed: boolean; count: number; onChange: (pressed: boolean) => void }) {
  return <Button type="button" variant="outline" aria-pressed={pressed} onClick={() => onChange(!pressed)}
    className={cn("min-h-10 gap-1 px-3 text-muted-foreground", pressed && "border-destructive/30 bg-destructive/10 font-semibold text-destructive hover:bg-destructive/15 hover:text-destructive")}>
    Solo detenidos{" "}<span className="font-medium tabular-nums">{number.format(count)}</span>
  </Button>;
}

export type FacetOption = { value: string | undefined; label: string; count: number };
/** «Todas» first, then one option per facet entry; each facet ignores only its own filter, so they add up to «Todas». */
export function facetOptions(all: string, entries: [string, string, number][]): FacetOption[] {
  return [{ value: undefined, label: all, count: entries.reduce((sum, [, , count]) => sum + count, 0) }, ...entries.map(([value, label, count]) => ({ value, label, count }))];
}
/** The status switch of a list, from its facet. */
export function FacetSwitch({ label, options, selected, onChange }: { label: string; options: FacetOption[]; selected: string | undefined; onChange: (value: string | undefined) => void }) {
  return <div role="group" aria-label={label} className="flex flex-wrap rounded-xl border bg-card p-0.5">
    {options.map(option => {
      const pressed = option.value === selected;
      return <Button key={option.label} type="button" variant="ghost" aria-pressed={pressed} onClick={() => onChange(option.value)}
        className={cn("min-h-10 rounded-lg px-3 text-muted-foreground", pressed && "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary")}>
        {option.label}{" "}<span className="font-medium tabular-nums text-muted-foreground">{number.format(option.count)}</span>
      </Button>;
    })}
  </div>;
}

/** The backend's default order: asc on text columns, desc on the rest. */
export const defaultOrder = (sort: string): "asc" | "desc" => ["title", "candidate", "reason"].includes(sort) ? "asc" : "desc";

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

/** The records of a page, sorted on the server from the header buttons (rule 12: one-line cells, numbers right-aligned). */
export function RecordsTable({ table, caption, sort, order, onSort }: {
  table: RecordsTableData; caption: string; sort: string; order: "asc" | "desc"; onSort: (sort: string, order: "asc" | "desc") => void;
}) {
  const sortedColumn = table.columns.find(column => column.sort === sort);
  return <div className="flex min-w-0 flex-col gap-2">
    {sortedColumn && <p className="text-xs text-muted-foreground">{`Fechas en hora del centro de México · ordenado por ${sortedColumn.header.toLowerCase()}, ${order === "asc" ? "ascendente" : "descendente"}`}</p>}
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <Headers columns={table.columns} sort={sort} order={order} onSort={onSort} />
        <TableBody>{table.rows.map(row => <TableRow key={row.id}>
          {row.cells.map((cell, index) => <TableCell key={table.columns[index].id} className={cn("h-14 whitespace-nowrap", table.columns[index].numeric && "text-right tabular-nums")}>{cell}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </div>;
}

/** Rule 15: the skeleton mirrors the table (its real headers, four rows). */
export function RecordsSkeleton({ columns }: { columns: Column<never>[] }) {
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

/** «1–50 de 120» and the cursor buttons. */
export function Pager({ range, hasPrevious, hasNext, pending, onPrevious, onNext }: {
  range: string; hasPrevious: boolean; hasNext: boolean; pending: boolean; onPrevious: () => void; onNext: () => void;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-muted-foreground">
    <span className="tabular-nums">{range}</span>
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!hasPrevious || pending} onClick={onPrevious}>Anterior</Button>
      <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>Siguiente</Button>
    </div>
  </div>;
}
/** «1–50» from the first row's position and the page size. */
export const rowRange = (first: number, size: number) => `${number.format(first)}–${number.format(first + size - 1)}`;
