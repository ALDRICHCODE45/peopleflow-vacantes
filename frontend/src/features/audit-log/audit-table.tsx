"use client";
import type { KeyboardEvent } from "react";
import { RichDataTable, type RichDataTableProps } from "@/components/data-table/rich-data-table";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditColumns } from "./audit-columns";
import type { AuditEvent } from "./model";

/** No pinned column: Cuándo leads, as in the artboard, and the table fits a 1440 px page without scrolling. */
const defaultPinning = { start: [], end: [] };
/** The card content is edge to edge; the outer cells take the card's own inset so text never touches the table edge. */
const EDGE_INSET = "[&_tr>*:first-child]:pl-(--card-spacing) [&_tr>*:last-child]:pr-(--card-spacing)";
/** The shared table fixes its rows at 100 px; here they take their content (up to the three-line clamp), cells aligned to the top as in the artboard. */
const ROWS = "[&_tbody_tr]:h-auto [&_tbody_td]:py-3 [&_tbody_td]:align-top";

/** One row per recorded event, in the talent base's rich table; clicking a row or pressing Enter on it opens the event detail; every nullable of the contract has an honest, neutral reading. */
export function AuditTable({ items, toolbar, loading = false, onOpen }: { items: AuditEvent[]; toolbar?: RichDataTableProps<AuditEvent>["toolbar"]; loading?: boolean; onOpen?: (event: AuditEvent) => void }) {
  // While another page loads, the skeleton replaces the rows and the column controls stay in the toolbar.
  // Space opens the detail like Enter (the shared table only knows Enter). It acts on the row itself: a control inside keeps its own Space.
  const openWithSpace = (press: KeyboardEvent<HTMLDivElement>) => {
    const { target } = press;
    if (press.key !== " " || press.defaultPrevented || !(target instanceof HTMLTableRowElement) || target.parentElement?.tagName !== "TBODY") return;
    const item = items[target.sectionRowIndex];
    if (!item) return;
    press.preventDefault();
    onOpen?.(item);
  };
  return <div data-audit-table className={cn(EDGE_INSET, ROWS)} onKeyDown={openWithSpace}>
    <RichDataTable id="audit-log" columns={auditColumns} data={items} getRowId={event => event.id} defaultPinning={defaultPinning} onRowActivate={onOpen} emptyState={null} toolbar={toolbar} compactControls content={loading ? <AuditTableSkeleton /> : undefined} />
  </div>;
}

/** Same blocks as the table: the real headers over skeleton rows, so loading does not shift the layout. */
export function AuditTableSkeleton() {
  const width = auditColumns.reduce((sum, column) => sum + column.size, 0);
  return <div data-audit-skeleton="table" aria-hidden="true" className={EDGE_INSET}><Table className="table-fixed" style={{ width: "100%", minWidth: width }}>
    <TableHeader><TableRow>{auditColumns.map(column => <TableHead key={column.id} style={column.meta.grow ? undefined : { width: column.size }}>{column.meta.label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{auditColumns.map(column => <TableCell key={column.id}>
      <div className="flex min-w-0 items-center gap-2">{column.id === "actor" && <Skeleton className="size-10 shrink-0 rounded-full" />}<Skeleton className="h-10 w-28 max-w-full" /></div>
    </TableCell>)}</TableRow>)}</TableBody>
  </Table></div>;
}
