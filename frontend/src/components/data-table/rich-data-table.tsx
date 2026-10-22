"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  tableFeatures, columnOrderingFeature, columnPinningFeature, columnVisibilityFeature, columnSizingFeature,
  useTable, FlexRender, type Column, type ColumnDef, type Header, type ColumnPinningState, type RowData, type Table as TableInstance,
} from "@tanstack/react-table";
import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { Columns3, Ellipsis, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTablePreferences } from "./use-table-preferences";
import styles from "./rich-data-table.module.css";

export const richTableFeatures = tableFeatures({ columnOrderingFeature, columnPinningFeature, columnVisibilityFeature, columnSizingFeature });
type Features = typeof richTableFeatures;
export type RichColumnDef<T extends RowData> = ColumnDef<Features, T> & {
  id: string; size: number;
  meta: { label: string; align?: "left" | "center" | "right" };
  enableReorder?: boolean;
};
export type RichDataTableProps<T extends RowData> = {
  id: string; columns: RichColumnDef<T>[]; data: T[]; getRowId: (row: T) => string;
  defaultPinning?: ColumnPinningState; onRowActivate?: (row: T) => void;
  emptyState: ReactNode; footer?: ReactNode;
  /** Render inline, in a page toolbar (e.g. a portal), or omit by returning null. */
  toolbar?: (controls: ReactNode) => ReactNode;
};
const NO_PINNING: ColumnPinningState = { start: [], end: [] };
const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest("button,a,input,select,textarea,[role=menuitem],[role=menuitemcheckbox],[data-row-action]");
function pinStyle<T extends RowData>(column: Column<Features, T>): CSSProperties {
  const pinned = column.getIsPinned();
  return { width: column.getSize(), textAlign: (column.columnDef.meta as RichColumnDef<T>["meta"]).align ?? "left",
    ...(pinned ? { position: "sticky", ...(pinned === "start" ? { left: column.getStart("start") } : { right: column.getAfter("end") }) } : {}) };
}
function canReorder<T extends RowData>(column: Column<Features, T>) {
  return !column.getIsPinned() && (column.columnDef as RichColumnDef<T>).enableReorder !== false;
}
function movableColumns<T extends RowData>(table: TableInstance<Features, T>) {
  return table.getCenterVisibleLeafColumns().filter(canReorder);
}
/** Hidden and fixed columns remain in the complete order; only the movable item is inserted beside its visible target. */
function moveTo<T extends RowData>(table: TableInstance<Features, T>, id: string, target: string) {
  const movable = movableColumns(table).map(column => column.id);
  if (id === target || !movable.includes(id) || !movable.includes(target)) return;
  table.setColumnOrder(previous => {
    const next = [...previous];
    const from = next.indexOf(id); const to = next.indexOf(target);
    if (from < 0 || to < 0) return previous;
    next.splice(from, 1); next.splice(to, 0, id); return next;
  });
}
function ColumnHeader<T extends RowData>({ header, table, shadow }: { header: Header<Features, T>; table: TableInstance<Features, T>; shadow?: string }) {
  const column = header.column;
  const label = (column.columnDef.meta as RichColumnDef<T>["meta"]).label;
  const draggable = canReorder(column);
  const drag = useDraggable({ id: column.id, disabled: !draggable });
  const drop = useDroppable({ id: column.id, disabled: !draggable });
  const setRef = useCallback((node: HTMLTableCellElement | null) => { drag.setNodeRef(node); drop.setNodeRef(node); }, [drag.setNodeRef, drop.setNodeRef]);
  const movable = movableColumns(table);
  const index = movable.findIndex(item => item.id === column.id);
  const neighbor = (direction: -1 | 1) => index >= 0 ? movable[index + direction] : undefined;
  const pinned = column.getIsPinned();
  const hasControls = column.getCanPin() || column.getCanHide() || draggable;
  return <TableHead ref={setRef} data-column-id={column.id} data-pinned={pinned || undefined} data-shadow={shadow}
    style={{ ...pinStyle(column), ...(drag.transform ? { transform: `translateX(${drag.transform.x}px)` } : {}) }}
    className={cn(styles.header, styles.cell, "group/header relative h-10", drag.isDragging && "opacity-50")}>
    <div data-header-label className="whitespace-nowrap"><FlexRender header={header} /></div>
    {hasControls && <div data-header-controls className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-card opacity-0 shadow-sm transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
      {draggable && <Button type="button" variant="ghost" size="icon-xs" aria-label={`Arrastrar ${label}`} className="shrink-0 cursor-grab touch-none" {...drag.listeners} {...drag.attributes} tabIndex={0}><GripVertical aria-hidden="true" /></Button>}
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="shrink-0" aria-label={`Opciones de ${label}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56"><DropdownMenuGroup>
          <DropdownMenuItem disabled={!column.getCanPin() || pinned === "start"} onClick={() => column.pin("start")}>Fijar a la izquierda</DropdownMenuItem>
          <DropdownMenuItem disabled={!column.getCanPin() || pinned === "end"} onClick={() => column.pin("end")}>Fijar a la derecha</DropdownMenuItem>
          <DropdownMenuItem disabled={!column.getCanPin() || !pinned} onClick={() => column.pin(false)}>Desfijar</DropdownMenuItem>
          <DropdownMenuItem disabled={!neighbor(-1)} onClick={() => { const target = neighbor(-1); if (target) moveTo(table, column.id, target.id); }}>Mover a la izquierda</DropdownMenuItem>
          <DropdownMenuItem disabled={!neighbor(1)} onClick={() => { const target = neighbor(1); if (target) moveTo(table, column.id, target.id); }}>Mover a la derecha</DropdownMenuItem>
          <DropdownMenuItem disabled={!column.getCanHide()} onClick={() => column.toggleVisibility(false)}>Ocultar columna</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>}
  </TableHead>;
}
function ViewControls<T extends RowData>({ table, reset }: { table: TableInstance<Features, T>; reset: () => void }) {
  const hideable = table.getAllLeafColumns().filter(column => column.getCanHide());
  const hidden = hideable.filter(column => !column.getIsVisible()).length;
  return <div className="flex items-center gap-2">
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" aria-label={hidden ? `Columnas · ${hidden} ocultas` : "Columnas"} />}>
      <Columns3 aria-hidden="true" />Columnas{hidden > 0 && <Badge variant="secondary">{hidden}</Badge>}
    </DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-48"><DropdownMenuGroup>
      {hideable.map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} closeOnClick={false} onCheckedChange={value => column.toggleVisibility(value)}>{(column.columnDef.meta as RichColumnDef<T>["meta"]).label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    <Button type="button" variant="ghost" size="sm" onClick={reset}><RotateCcw aria-hidden="true" />Restablecer vista</Button>
  </div>;
}

/** Flat, fixed-pixel columns. All sticky geometry comes from the same TanStack sizing model as the table. */
export function RichDataTable<T extends RowData>({ id, columns, data, getRowId, defaultPinning = NO_PINNING, onRowActivate, emptyState, footer, toolbar }: RichDataTableProps<T>) {
  const defaults = useMemo(() => {
    const fixed = columns.filter(column => column.enablePinning === false).map(column => column.id);
    return { order: columns.map(column => column.id), pinning: defaultPinning, visibility: {},
      nonHideable: columns.filter(column => column.enableHiding === false).map(column => column.id),
      fixedPinning: { start: defaultPinning.start.filter(id => fixed.includes(id)), end: defaultPinning.end.filter(id => fixed.includes(id)) },
    };
  }, [columns, defaultPinning]);
  const { preferences, setOrder, setPinning, setVisibility, reset } = useTablePreferences(id, defaults);
  const table = useTable({ features: richTableFeatures, columns, data, getRowId,
    state: { columnOrder: preferences.order, columnPinning: preferences.pinning, columnVisibility: preferences.visibility },
    onColumnOrderChange: setOrder, onColumnPinningChange: setPinning, onColumnVisibilityChange: setVisibility,
    defaultColumn: { header: ({ column }) => (column.columnDef.meta as RichColumnDef<T>["meta"]).label },
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = { start: node.scrollLeft > 1, end: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
    setEdges(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  }, []);
  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (scrollRef.current) { observer?.observe(scrollRef.current); const element = scrollRef.current.querySelector("table"); if (element) observer?.observe(element); }
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure, columns, preferences]);
  const shadow = (column: Column<Features, T>) => column.getIsPinned() === "start" && column.getIsLastColumn("start") && edges.start ? "start"
    : column.getIsPinned() === "end" && column.getIsFirstColumn("end") && edges.end ? "end" : undefined;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const controls = <ViewControls table={table} reset={reset} />;
  return <div className="flex min-w-0 flex-col gap-3">
    {toolbar ? toolbar(controls) : controls}
    <DndContext id={`rich-table-${id}`} sensors={sensors} collisionDetection={pointerWithin}
      accessibility={{ screenReaderInstructions: { draggable: "Para mover una columna con teclado, abre sus opciones y elige Mover a la izquierda o Mover a la derecha." }, announcements: {
        onDragStart: ({ active }) => `Moviendo ${(table.getColumn(String(active.id))?.columnDef.meta as RichColumnDef<T>["meta"])?.label ?? "columna"}`,
        onDragOver: ({ over }) => over ? "Suelta sobre esta columna para moverla" : undefined,
        onDragEnd: ({ over }) => over ? "Columna movida" : "No se movió la columna", onDragCancel: () => "Movimiento cancelado",
      } }}
      onDragEnd={({ active, over }) => { if (over) moveTo(table, String(active.id), String(over.id)); }}>
      <div ref={scrollRef} role="region" aria-label="Tabla con desplazamiento horizontal" tabIndex={0} onScroll={measure} className="min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>[data-slot=table-container]]:overflow-visible">
        <Table className="table-fixed" style={{ width: table.getTotalSize(), minWidth: table.getTotalSize() }}>
          <TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id}>{group.headers.map(header => <ColumnHeader key={header.id} header={header} table={table} shadow={shadow(header.column)} />)}</TableRow>)}</TableHeader>
          <TableBody>{table.getRowModel().rows.length ? table.getRowModel().rows.map(row => <TableRow key={row.id} className={cn(styles.row, "h-[100px]", onRowActivate && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            tabIndex={onRowActivate ? 0 : undefined}
            onClick={event => { if (!interactive(event.target)) onRowActivate?.(row.original); }}
            onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); onRowActivate?.(row.original); } }}>
            {row.getVisibleCells().map(cell => <TableCell key={cell.id} data-column-id={cell.column.id} data-pinned={cell.column.getIsPinned() || undefined} data-shadow={shadow(cell.column)} style={pinStyle(cell.column)} className={styles.cell}><FlexRender cell={cell} /></TableCell>)}
          </TableRow>) : <TableRow><TableCell colSpan={table.getVisibleLeafColumns().length}>{emptyState}</TableCell></TableRow>}</TableBody>
        </Table>
      </div>
    </DndContext>
    {footer}
  </div>;
}
