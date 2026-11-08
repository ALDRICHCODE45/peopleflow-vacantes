"use client";
import { Badge } from "@/components/ui/badge";
import { applicationColumns, candidateColumns, deliveryColumns, instantDay, type CellContext, type Column, type Table } from "@/features/company-metrics/detail/detail-columns";
import { number, personName, requesterLabel, type DeliveryListRow } from "@/features/company-metrics/model";
import type { DashboardDetailPage, DashboardVacancyRow } from "./model";
import type { DashboardDetailState } from "./query";

/**
 * The tables of the dashboard lists (artboard 08, rule 12: at most six columns). Candidates and applications are the
 * metrics §5.5 / §5.6 tables as they are; deliveries are the metrics §5.1 table for open commitments, so «Entregada»
 * (never set on an unfulfilled delivery) gives its place to the person responsible.
 */
const responsible: Column<DeliveryListRow> = {
  id: "responsible", header: "Responsable", cell: row => row.attributed_to.length ? row.attributed_to.map(personName).join(", ") : "—",
};
const dashboardDeliveryColumns = (overdue: boolean): Column<DeliveryListRow>[] => {
  const [vacancy, requester, ...rest] = deliveryColumns(overdue).filter(column => column.id !== "reached");
  return [vacancy, requester, responsible, ...rest];
};

const STATUS: Record<DashboardVacancyRow["status"], { label: string; variant: "accent" | "outline" }> = {
  published: { label: "Publicada", variant: "accent" }, paused: { label: "Pausada", variant: "outline" },
  closed: { label: "Cerrada", variant: "outline" }, finished: { label: "Finalizada", variant: "outline" },
};
const vacancyColumns: Column<DashboardVacancyRow>[] = [
  { id: "vacancy", header: "Vacante", sort: "title", cell: (row, context) => context.vacancy(row.vacancy) },
  { id: "requester", header: "Cliente o área", cell: row => requesterLabel(row.requester) },
  { id: "status", header: "Estado", cell: row => <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge> },
  { id: "published", header: "Publicada", sort: "published_at", cell: row => instantDay(row.published_at) },
  { id: "in_process", header: "En proceso", sort: "in_process", numeric: true, cell: row => number.format(row.in_process) },
  // Open = required − covered, never below 0 (the backend's positions_open sort).
  { id: "positions", header: "Posiciones por cubrir", sort: "positions_open", numeric: true,
    cell: row => `${number.format(Math.max(row.positions.required - row.positions.covered, 0))} de ${number.format(row.positions.required)}` },
];

const overdueList = (state: DashboardDetailState) => state.params.state === "overdue";
/** Columns and rows of a page, typed together so a row is only ever read by its own columns. */
export function dashboardTable(state: DashboardDetailState, data: DashboardDetailPage, context: CellContext): Table {
  const build = <R,>(columns: Column<R>[], items: R[], id: (row: R) => string): Table => ({
    columns: columns as Column<never>[],
    rows: items.map((row, index) => ({ id: `${id(row)}:${index}`, cells: columns.map(column => column.cell(row, context)) })),
  });
  switch (data.kind) {
    case "candidates": return build(candidateColumns, data.page.items, row => row.participation_id);
    case "deliveries": return build(dashboardDeliveryColumns(overdueList(state)), data.page.items, row => row.vacancy.draft_id);
    case "vacancies": return build(vacancyColumns, data.page.items, row => row.vacancy.draft_id);
    case "applications": return build(applicationColumns, data.page.items, row => row.vacancy.draft_id);
  }
}
/** The headers alone, for the skeleton before the first page. */
export function dashboardColumns(state: DashboardDetailState): Column<never>[] {
  const columns = { candidates: candidateColumns, deliveries: dashboardDeliveryColumns(overdueList(state)), vacancies: vacancyColumns, applications: applicationColumns }[state.kind];
  return columns as Column<never>[];
}
