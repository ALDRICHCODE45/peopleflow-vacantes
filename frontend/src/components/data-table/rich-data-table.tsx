"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  tableFeatures, columnOrderingFeature, columnPinningFeature, columnVisibilityFeature, columnSizingFeature,
  useTable, FlexRender, type Column, type ColumnDef, type Header, type ColumnPinningState, type RowData, type Table as TableInstance,
} from "@tanstack/react-table";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, Columns3, Ellipsis, EyeOff, Pin, PinOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTablePreferences } from "./use-table-preferences";
import styles from "./rich-data-table.module.css";

export const richTableFeatures = tableFeatures({ columnOrderingFeature, columnPinningFeature, columnVisibilityFeature, columnSizingFeature });
type Features = typeof richTableFeatures;
export type RichColumnDef<T extends RowData> = ColumnDef<Features, T> & {
  id: string; size: number;
  meta: { label: string; align?: "left" | "center" | "right"; grow?: boolean };
  enableReorder?: boolean;
};
export type RichDataTableProps<T extends RowData> = {
  id: string; columns: RichColumnDef<T>[]; data: T[]; getRowId: (row: T) => string;
  defaultPinning?: ColumnPinningState; onRowActivate?: (row: T) => void;
  emptyState: ReactNode; footer?: ReactNode;
  /** Render inline, in a page toolbar (e.g. a portal), or omit by returning null. */
  toolbar?: (controls: ReactNode) => ReactNode;
  /** Alternate row presentation keeps the same column preferences and controls. */
  content?: ReactNode;
  beforeContent?: (visibleColumnIds: string[]) => ReactNode;
  compactControls?: boolean;
  sortState?: { id: string; direction: "ascending" | "descending" | "none" };
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
function ColumnHeader<T extends RowData>({ header, table, shadow, dropEdge, sortState }: {
  header: Header<Features, T>; table: TableInstance<Features, T>; shadow?: string; dropEdge?: "start" | "end"; sortState?: RichDataTableProps<T>["sortState"];
}) {
  const column = header.column;
  const label = (column.columnDef.meta as RichColumnDef<T>["meta"]).label;
  const draggable = canReorder(column);
  const drag = useDraggable({ id: column.id, disabled: !draggable });
  const drop = useDroppable({ id: column.id, disabled: !draggable });
  const movable = movableColumns(table);
  const index = movable.findIndex(item => item.id === column.id);
  const neighbor = (direction: -1 | 1) => index >= 0 ? movable[index + direction] : undefined;
  const pinned = column.getIsPinned();
  const hasControls = column.getCanPin() || column.getCanHide() || draggable;
  return <TableHead ref={drop.setNodeRef} scope="col" aria-label={label} aria-sort={sortState?.id === column.id ? sortState.direction : undefined} data-column-id={column.id} data-pinned={pinned || undefined} data-shadow={shadow} data-drop-edge={dropEdge}
    style={pinStyle(column)}
    className={cn(styles.header, styles.cell, "group/header relative h-10", drag.isDragging && "opacity-50")}>
    <div className="flex min-w-0 items-center gap-1">
      <div ref={drag.setNodeRef} data-header-label {...(draggable ? drag.listeners : {})}
        className={cn("min-w-0 flex-1 truncate", (column.columnDef.meta as RichColumnDef<T>["meta"]).align === "center" && "flex justify-center", draggable && "cursor-grab touch-none select-none active:cursor-grabbing")}><FlexRender header={header} /></div>
      {pinned && hasControls && <Pin data-pinned-indicator aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
      {hasControls && <div data-header-controls className="shrink-0 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="shrink-0" aria-label={`Opciones de ${label}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56"><DropdownMenuGroup>
          <DropdownMenuItem disabled={!column.getCanPin() || pinned === "start"} onClick={() => column.pin("start")}><Pin aria-hidden="true" />Fijar a la izquierda</DropdownMenuItem>
          <DropdownMenuItem disabled={!column.getCanPin() || pinned === "end"} onClick={() => column.pin("end")}><Pin aria-hidden="true" />Fijar a la derecha</DropdownMenuItem>
          <DropdownMenuItem disabled={!column.getCanPin() || !pinned} onClick={() => column.pin(false)}><PinOff aria-hidden="true" />Desfijar</DropdownMenuItem>
        </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup>
          <DropdownMenuItem disabled={!neighbor(-1)} onClick={() => { const target = neighbor(-1); if (target) moveTo(table, column.id, target.id); }}><ArrowLeft aria-hidden="true" />Mover a la izquierda</DropdownMenuItem>
          <DropdownMenuItem disabled={!neighbor(1)} onClick={() => { const target = neighbor(1); if (target) moveTo(table, column.id, target.id); }}><ArrowRight aria-hidden="true" />Mover a la derecha</DropdownMenuItem>
        </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup>
          <DropdownMenuItem disabled={!column.getCanHide()} onClick={() => column.toggleVisibility(false)}><EyeOff aria-hidden="true" />Ocultar columna</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      </div>}
    </div>
  </TableHead>;
}
function ViewControls<T extends RowData>({ table, reset, isDefault, compact }: { table: TableInstance<Features, T>; reset: () => void; isDefault: boolean; compact: boolean }) {
  const hideable = table.getAllLeafColumns().filter(column => column.getCanHide());
  const hidden = hideable.filter(column => !column.getIsVisible()).length;
  return <div className="flex items-center gap-2">
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className={compact ? "min-h-10" : undefined} aria-label={hidden ? `Columnas · ${hidden} ocultas` : "Columnas"} />}>
      <Columns3 aria-hidden="true" />Columnas{hidden > 0 && <Badge variant="secondary">{hidden}</Badge>}
    </DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-48"><DropdownMenuGroup>
      {hideable.map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} closeOnClick={false} onCheckedChange={value => column.toggleVisibility(value)}>{(column.columnDef.meta as RichColumnDef<T>["meta"]).label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    {compact ? <TooltipProvider><Tooltip><TooltipTrigger render={<span className="inline-flex" tabIndex={isDefault ? 0 : undefined} />}><Button type="button" variant="ghost" size="icon" className="size-10" aria-label="Restablecer vista" disabled={isDefault} onClick={reset}><RotateCcw aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Restablecer vista</TooltipContent></Tooltip></TooltipProvider>
      : <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={reset}><RotateCcw aria-hidden="true" />Restablecer vista</Button>}
  </div>;
}

/** Flat, fixed-pixel columns. All sticky geometry comes from the same TanStack sizing model as the table. */
export function RichDataTable<T extends RowData>({ id, columns, data, getRowId, defaultPinning = NO_PINNING, onRowActivate, emptyState, footer, toolbar, content, beforeContent, compactControls = false, sortState }: RichDataTableProps<T>) {
  const defaults = useMemo(() => {
    const fixed = columns.filter(column => column.enablePinning === false).map(column => column.id);
    return { order: columns.map(column => column.id), pinning: defaultPinning, visibility: {},
      nonHideable: columns.filter(column => column.enableHiding === false).map(column => column.id),
      fixedPinning: { start: defaultPinning.start.filter(id => fixed.includes(id)), end: defaultPinning.end.filter(id => fixed.includes(id)) },
    };
  }, [columns, defaultPinning]);
  const { preferences, setOrder, setPinning, setVisibility, reset, isDefault } = useTablePreferences(id, defaults);
  const [viewportWidth, setViewportWidth] = useState(0);
  // Use the sizing model for the fill column too: CSS-only stretching would invalidate sticky offsets.
  const columnSizing = useMemo(() => {
    const visible = columns.filter(column => preferences.visibility[column.id] !== false);
    const basis = (column: RichColumnDef<T>) => Math.min(column.maxSize ?? Number.MAX_SAFE_INTEGER, Math.max(column.minSize ?? 20, column.size));
    const total = visible.reduce((sum, column) => sum + basis(column), 0);
    const flexible = visible.find(column => column.meta.grow)
      ?? visible.find(column => column.enableReorder !== false) ?? visible[0];
    return Object.fromEntries(columns.map(column => [column.id, basis(column) + (column === flexible ? Math.max(0, viewportWidth - total) : 0)]));
  }, [columns, preferences.visibility, viewportWidth]);
  const table = useTable({ features: richTableFeatures, columns, data, getRowId,
    state: { columnOrder: preferences.order, columnPinning: preferences.pinning, columnVisibility: preferences.visibility, columnSizing },
    onColumnOrderChange: setOrder, onColumnPinningChange: setPinning, onColumnVisibilityChange: setVisibility,
    defaultColumn: { header: ({ column }) => (column.columnDef.meta as RichColumnDef<T>["meta"]).label },
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setViewportWidth(node.clientWidth);
    const next = { start: node.scrollLeft > 1, end: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
    setEdges(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  }, []);
  // The scroll region only exists while no `content` placeholder is shown; re-measure and
  // observe it when it mounts, or the fill column keeps its base width until a resize.
  const tableMounted = content === undefined;
  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (scrollRef.current) { observer?.observe(scrollRef.current); const element = scrollRef.current.querySelector("table"); if (element) observer?.observe(element); }
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure, columns, preferences, columnSizing, tableMounted]);
  const shadow = (column: Column<Features, T>) => column.getIsPinned() === "start" && column.getIsLastColumn("start") && edges.start ? "start"
    : column.getIsPinned() === "end" && column.getIsFirstColumn("end") && edges.end ? "end" : undefined;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const controls = <ViewControls table={table} reset={reset} isDefault={isDefault} compact={compactControls} />;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const movable = movableColumns(table).map(column => column.id);
  const dropEdge = (target: string): "start" | "end" | undefined => activeId && overId === target && activeId !== target && movable.includes(activeId) && movable.includes(target)
    ? movable.indexOf(activeId) < movable.indexOf(target) ? "end" : "start" : undefined;
  const clearDrag = () => { setActiveId(null); setOverId(null); };
  return <div className="flex min-w-0 flex-col gap-3">
    {toolbar ? toolbar(controls) : controls}
    {beforeContent?.([...table.getStartVisibleLeafColumns(), ...table.getCenterVisibleLeafColumns(), ...table.getEndVisibleLeafColumns()].map(column => column.id))}
    {content !== undefined ? content : <DndContext id={`rich-table-${id}`} sensors={sensors} collisionDetection={pointerWithin}
      accessibility={{ screenReaderInstructions: { draggable: "Para mover una columna con teclado, abre sus opciones y elige Mover a la izquierda o Mover a la derecha." }, announcements: {
        onDragStart: ({ active }) => `Moviendo ${(table.getColumn(String(active.id))?.columnDef.meta as RichColumnDef<T>["meta"])?.label ?? "columna"}`,
        onDragOver: ({ over }) => over ? "Suelta sobre esta columna para moverla" : undefined,
        onDragEnd: ({ over }) => over ? "Columna movida" : "No se movió la columna", onDragCancel: () => "Movimiento cancelado",
      } }}
      onDragStart={({ active }) => { if (movable.includes(String(active.id))) setActiveId(String(active.id)); }}
      onDragOver={({ active, over }) => { setOverId(over && over.id !== active.id && movable.includes(String(over.id)) ? String(over.id) : null); }}
      onDragCancel={clearDrag}
      onDragEnd={({ active, over }) => { clearDrag(); if (over) moveTo(table, String(active.id), String(over.id)); }}>
      <div ref={scrollRef} role="region" aria-label="Tabla con desplazamiento horizontal" tabIndex={0} onScroll={measure} className="min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>[data-slot=table-container]]:overflow-visible">
        <Table className="table-fixed" style={{ width: table.getTotalSize(), minWidth: table.getTotalSize() }}>
          <TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id}>{group.headers.map(header => <ColumnHeader key={header.id} header={header} table={table} sortState={sortState} shadow={shadow(header.column)} dropEdge={dropEdge(header.column.id)} />)}</TableRow>)}</TableHeader>
          <TableBody>{table.getRowModel().rows.length ? table.getRowModel().rows.map(row => <TableRow key={row.id} className={cn(styles.row, "h-[100px]", onRowActivate && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            tabIndex={onRowActivate ? 0 : undefined}
            onClick={event => { if (!interactive(event.target)) onRowActivate?.(row.original); }}
            onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); onRowActivate?.(row.original); } }}>
            {row.getVisibleCells().map(cell => <TableCell key={cell.id} data-column-id={cell.column.id} data-pinned={cell.column.getIsPinned() || undefined} data-shadow={shadow(cell.column)} style={pinStyle(cell.column)} className={styles.cell}><FlexRender cell={cell} /></TableCell>)}
          </TableRow>) : <TableRow><TableCell colSpan={table.getVisibleLeafColumns().length}>{emptyState}</TableCell></TableRow>}</TableBody>
        </Table>
      </div>
      <DragOverlay dropAnimation={null} aria-hidden="true">
        {activeId && <Item data-drag-preview variant="outline" className="min-w-max bg-card shadow-lg"><ItemContent><ItemTitle>{columns.find(column => column.id === activeId)?.meta.label}</ItemTitle></ItemContent></Item>}
      </DragOverlay>
    </DndContext>}
    {footer}
  </div>;
}
