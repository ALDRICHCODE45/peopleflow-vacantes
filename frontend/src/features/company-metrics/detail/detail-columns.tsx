"use client";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CLOSE_REASON_LABEL, dayLabel, MX_TIME_ZONE, number, personName, plural, REASSIGNMENT_REASON_LABEL, requesterLabel,
  type DeliveryListRow, type DetailPage, type PlacementListRow, type ReassignmentRow, type VacancyListRow,
} from "../model";
import { DELIVERY_TONE } from "../palette";
import type { DetailState, ListKind } from "./query";

/**
 * The table of each list kind (artboard 08, `design/system.md` rule 12): at most six columns, one-line cells, numbers
 * right-aligned, the vacancy (or candidate) first. `sort` is the API sort key behind the header button.
 */
export type VacancyRef = { draft_id: string; title: string | null };
export type CellContext = { vacancy: (ref: VacancyRef) => ReactNode };
export type Column<R> = { id: string; header: string; sort?: string; numeric?: boolean; cell: (row: R, context: CellContext) => ReactNode };

const momentDay = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
/** The Mexico City day of an instant («25 sep 2026»); missing is «—». */
const instantDay = (value: string | null) => value ? momentDay.format(new Date(value)).replace(".", "") : "—";
const civilDay = (value: string | null) => value ? dayLabel(value) : "—";
const people = (list: { name: string | null }[]) => list.length ? list.map(personName).join(", ") : "—";
const days = (value: number) => plural(value, "día", "días");

/** Days late with the «tarde» tint of rule 9; overdue days with the alarm tone; otherwise a muted dash. */
function DelayCell({ row }: { row: DeliveryListRow }) {
  if (row.business_days_late) return <span className="inline-flex h-6 min-w-16 items-center justify-end rounded-md px-2 font-semibold tabular-nums"
    style={{ background: `color-mix(in oklab, ${DELIVERY_TONE.late} 55%, var(--card))` }}>{days(row.business_days_late)}</span>;
  if (row.business_days_overdue) return <span className="inline-flex h-6 min-w-16 items-center justify-end gap-1 rounded-md border px-2 font-semibold tabular-nums"
    style={{ borderColor: DELIVERY_TONE.overdue, color: DELIVERY_TONE.overdue }}>{`${days(row.business_days_overdue)} vencida`}</span>;
  return <span className="text-muted-foreground" aria-label="Sin retraso">—</span>;
}

const deliveryColumns = (state: DetailState): Column<DeliveryListRow>[] => [
  { id: "vacancy", header: "Vacante", sort: "title", cell: (row, context) => context.vacancy(row.vacancy) },
  { id: "requester", header: "Cliente o área", cell: row => requesterLabel(row.requester) },
  { id: "commitment", header: "Fecha meta", sort: "commitment_date", cell: row => civilDay(row.commitment_date) },
  { id: "reached", header: "Entregada", sort: "target_reached_at", cell: row => instantDay(row.target_reached_at) },
  // An overdue list sorts by days overdue; every other list by days late.
  { id: "delay", header: "Días de retraso", sort: state.params.result === "overdue" ? "business_days_overdue" : "business_days_late", numeric: true, cell: row => <DelayCell row={row} /> },
  { id: "delivered", header: "Candidatos entregados", sort: "delivered", numeric: true, cell: row => row.target ? `${number.format(row.delivered)} de ${number.format(row.target)}` : number.format(row.delivered) },
];

const vacancyColumns: Column<VacancyListRow>[] = [
  { id: "vacancy", header: "Vacante", sort: "title", cell: (row, context) => context.vacancy(row) },
  { id: "requester", header: "Cliente o área", cell: row => requesterLabel(row.requester) },
  { id: "responsible", header: "Responsable", cell: row => row.responsible ? personName(row.responsible) : "—" },
  { id: "opened", header: "Publicada", sort: "opened_at", cell: row => instantDay(row.opened_at) },
  { id: "closed", header: "Último cierre", sort: "last_close_date", cell: row => row.last_close ? `${civilDay(row.last_close.date)} · ${CLOSE_REASON_LABEL[row.last_close.reason ?? "no_reason"]}` : "—" },
  { id: "to_close", header: "Días hábiles para cerrar", sort: "business_days_to_close", numeric: true, cell: row => row.business_days_to_close === null ? "—" : number.format(row.business_days_to_close) },
];

const placementColumns: Column<PlacementListRow>[] = [
  // A candidate is never a link here: a stakeholder reaches no profile (§7) and the row carries no profile route.
  { id: "candidate", header: "Candidato", sort: "candidate", cell: row => <span className="font-medium">{row.candidate.full_name || "Candidato sin nombre"}</span> },
  { id: "vacancy", header: "Vacante", sort: "title", cell: (row, context) => context.vacancy(row.vacancy) },
  { id: "requester", header: "Cliente o área", cell: row => requesterLabel(row.requester) },
  { id: "recipients", header: "Acreditado a", cell: row => people(row.recipients.map(recipient => recipient.person)) },
  { id: "hired", header: "Contratación", sort: "hired_at", cell: row => instantDay(row.hired_at) },
  { id: "status", header: "Permanencia", cell: row => <Badge variant={row.status === "active" ? "accent" : "outline"}>{row.status === "active" ? "Se sostuvo" : "No se sostuvo"}</Badge> },
];

const reassignmentColumns: Column<ReassignmentRow>[] = [
  { id: "vacancy", header: "Vacante", sort: "title", cell: (row, context) => context.vacancy(row.vacancy) },
  { id: "from", header: "De", cell: row => row.from ? personName(row.from) : "—" },
  { id: "to", header: "A", cell: row => personName(row.to) },
  { id: "reason", header: "Motivo", sort: "reason", cell: row => REASSIGNMENT_REASON_LABEL[row.reason] },
  { id: "performed", header: "Fecha", sort: "performed_at", cell: row => instantDay(row.performed_at) },
];

/** Columns and rows of a page, typed together so a row is only ever read by its own columns. */
export type Table = { columns: Column<never>[]; rows: { id: string; cells: ReactNode[] }[] };
export function detailTable(state: DetailState, data: DetailPage, context: CellContext): Table {
  const build = <R,>(columns: Column<R>[], items: R[], id: (row: R) => string): Table => ({
    columns: columns as Column<never>[],
    rows: items.map((row, index) => ({ id: `${id(row)}:${index}`, cells: columns.map(column => column.cell(row, context)) })),
  });
  switch (data.kind) {
    case "deliveries": return build(deliveryColumns(state), data.page.items, row => row.vacancy.draft_id);
    case "vacancies": return build(vacancyColumns, data.page.items, row => row.draft_id);
    case "placements": return build(placementColumns, data.page.items, row => row.credit_id);
    case "reassignments": return build(reassignmentColumns, data.page.items, row => row.id);
  }
}
/** The headers alone, for the skeleton before the first page. */
export function detailColumns(state: DetailState & { kind: ListKind }): Column<never>[] {
  const columns = { deliveries: deliveryColumns(state), vacancies: vacancyColumns, placements: placementColumns, reassignments: reassignmentColumns }[state.kind];
  return columns as Column<never>[];
}
