"use client";
import { RichDataTable, type RichDataTableProps } from "@/components/data-table/rich-data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditColumns } from "./audit-columns";
import type { AuditEvent } from "./model";

const defaultPinning = { start: ["actor"], end: [] };

/** One row per recorded event, in the talent base's rich table; every nullable of the contract has an honest, neutral reading. */
export function AuditTable({ items, toolbar }: { items: AuditEvent[]; toolbar?: RichDataTableProps<AuditEvent>["toolbar"] }) {
  return <RichDataTable id="audit-log" columns={auditColumns} data={items} getRowId={event => event.id} defaultPinning={defaultPinning} emptyState={null} toolbar={toolbar} compactControls />;
}

/** Same blocks as the table: the real headers over skeleton rows, so loading does not shift the layout. */
export function AuditTableSkeleton() {
  const width = auditColumns.reduce((sum, column) => sum + column.size, 0);
  return <div data-audit-skeleton="table" aria-hidden="true"><Table className="table-fixed" style={{ width: "100%", minWidth: width }}>
    <TableHeader><TableRow>{auditColumns.map(column => <TableHead key={column.id} style={column.meta.grow ? undefined : { width: column.size }}>{column.meta.label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{auditColumns.map(column => <TableCell key={column.id}>
      <div className="flex min-w-0 items-center gap-2">{column.id === "actor" && <Skeleton className="size-10 shrink-0 rounded-full" />}<Skeleton className="h-10 w-28 max-w-full" /></div>
    </TableCell>)}</TableRow>)}</TableBody>
  </Table></div>;
}
