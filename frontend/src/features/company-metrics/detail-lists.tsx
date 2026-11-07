"use client";
import { createContext, useContext, useState } from "react";
import { BriefcaseBusiness, Ellipsis, Repeat, TriangleAlert } from "lucide-react";
import { RichDataTable, type RichColumnDef } from "@/components/data-table/rich-data-table";
import { TwoLineCell } from "@/components/data-table/truncated-text";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listReassignmentsAction, listVacanciesAction } from "./actions";
import { AuditedDetailSheet, type AuditedTarget } from "./audited-detail-sheet";
import { failureMessage } from "./failure";
import {
  CLOSE_REASON_LABEL, dayLabel, DELIVERY_RESULT_LABEL, momentLabel, number, personName, plural, REASSIGNMENT_REASON_LABEL, requesterKindLabel,
  requesterLabel, type Person, type ReassignmentRow, type VacancyRow,
} from "./model";
import { usePagedList, type PagedList } from "./use-paged-list";
import type { MetricsFilters } from "./url-state";

const OpenContext = createContext<(target: AuditedTarget) => void>(() => {});
const RESULT_TONE = { on_time: "success", late: "review", overdue: "danger", pending: "info", not_configured: "neutral" } as const;
const personLine = (person: Person | null, fallback: string) => person ? `${personName(person)}${person.former_member ? " · Ex miembro" : ""}` : fallback;

function DeliveryCell({ delivery }: { delivery: VacancyRow["delivery"] }) {
  if (delivery.result === "not_configured") return <TwoLineCell primary={DELIVERY_RESULT_LABEL.not_configured} missing />;
  const commitment = delivery.commitment_date ? `compromiso ${dayLabel(delivery.commitment_date)}` : null;
  const original = delivery.original_commitment_date && delivery.original_commitment_date !== delivery.commitment_date ? ` (antes ${dayLabel(delivery.original_commitment_date)})` : "";
  return <div className="flex min-w-0 flex-col items-start gap-1">
    <Badge variant={RESULT_TONE[delivery.result]} dot>{DELIVERY_RESULT_LABEL[delivery.result]}</Badge>
    <span className="w-full truncate text-[12.5px] text-muted-foreground">{[delivery.target !== null ? `${number.format(delivery.delivered)} de ${number.format(delivery.target)}` : null, commitment && `${commitment}${original}`].filter(Boolean).join(" · ")}</span>
  </div>;
}
function CloseCell({ row }: { row: VacancyRow }) {
  const last = row.closes.at(-1);
  if (!last) return <TwoLineCell primary="Abierta" secondary={row.first_published_at ? `publicada ${momentLabel(row.first_published_at).split(",")[0]}` : null} />;
  return <TwoLineCell primary={CLOSE_REASON_LABEL[last.reason ?? "no_reason"]} secondary={dayLabel(last.date)} />;
}
function VacancyActions({ row }: { row: VacancyRow }) {
  const open = useContext(OpenContext);
  const title = row.title ?? "Vacante sin título";
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${title}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuGroup>
      <DropdownMenuItem onClick={() => open({ report: "deliveries", vacancy: row })}>Ver entregados</DropdownMenuItem>
      <DropdownMenuItem onClick={() => open({ report: "placements", vacancy: row })}>Ver placements</DropdownMenuItem>
    </DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>;
}

const vacancyColumns: RichColumnDef<VacancyRow>[] = [
  { id: "title", size: 260, meta: { label: "Vacante", grow: true }, enableHiding: false, cell: ({ row }) => <TwoLineCell primary={row.original.title ?? "Vacante sin título"} secondary={`${requesterLabel(row.original.requester)} · ${requesterKindLabel(row.original.requester?.kind ?? null)}`} /> },
  { id: "responsible", size: 200, meta: { label: "Responsable actual" }, cell: ({ row }) => <TwoLineCell primary={personLine(row.original.responsible, "Sin responsable")} missing={!row.original.responsible} /> },
  { id: "delivery", size: 240, meta: { label: "Entrega" }, cell: ({ row }) => <DeliveryCell delivery={row.original.delivery} /> },
  { id: "close", size: 150, meta: { label: "Cierre" }, cell: ({ row }) => <CloseCell row={row.original} /> },
  { id: "positions", size: 120, meta: { label: "Posiciones" }, cell: ({ row }) => <TwoLineCell primary={`${row.original.placements.covered} de ${row.original.placements.required}`} /> },
  { id: "reassignments", size: 140, meta: { label: "Reasignaciones" }, cell: ({ row }) => <TwoLineCell primary={number.format(row.original.reassignments)} /> },
  { id: "actions", size: 56, header: () => <span className="sr-only">Acciones</span>, meta: { label: "Acciones", align: "center" }, enablePinning: false, enableHiding: false, enableReorder: false, cell: ({ row }) => <VacancyActions row={row.original} /> },
];
const reassignmentColumns: RichColumnDef<ReassignmentRow>[] = [
  { id: "performed_at", size: 170, meta: { label: "Fecha" }, enableHiding: false, cell: ({ row }) => <TwoLineCell primary={momentLabel(row.original.performed_at)} /> },
  { id: "vacancy", size: 240, meta: { label: "Vacante", grow: true }, cell: ({ row }) => <TwoLineCell primary={row.original.vacancy.title ?? "Vacante sin título"} /> },
  { id: "from", size: 200, meta: { label: "Dejó de ser responsable" }, cell: ({ row }) => <TwoLineCell primary={personLine(row.original.from, "Sin responsable")} missing={!row.original.from} /> },
  { id: "to", size: 200, meta: { label: "Pasó a ser responsable" }, cell: ({ row }) => <TwoLineCell primary={personLine(row.original.to, "")} /> },
  { id: "reason", size: 200, meta: { label: "Motivo" }, cell: ({ row }) => <TwoLineCell primary={REASSIGNMENT_REASON_LABEL[row.original.reason]} secondary={row.original.reason === "other" ? row.original.note : null} /> },
  { id: "performed_by", size: 180, meta: { label: "La hizo" }, cell: ({ row }) => <TwoLineCell primary={personLine(row.original.performed_by, "Sistema")} /> },
  { id: "outgoing", size: 150, meta: { label: "Tramo saliente" }, cell: ({ row }) => <TwoLineCell primary={row.original.outgoing_tramo_business_days === null ? "Sin dato" : plural(row.original.outgoing_tramo_business_days, "día hábil", "días hábiles")} missing={row.original.outgoing_tramo_business_days === null} /> },
];

function ListBody<T>({ list, render, empty }: { list: PagedList<T>; render: (items: T[]) => React.ReactNode; empty: React.ReactNode }) {
  if (list.failure) return <SectionEmpty icon={TriangleAlert} tone="info" title="No pudimos cargar la lista" description={failureMessage(list.failure, "la lista")} primaryAction={{ label: "Reintentar", onClick: list.retry }} />;
  if (!list.items) return <div role="status" aria-label="Cargando la lista" aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2].map(index => <Skeleton key={index} aria-hidden="true" className="h-16 w-full" />)}</div>;
  if (!list.items.length) return <>{empty}</>;
  return <div className="flex min-w-0 flex-col gap-3">
    {list.notice && <ActionStatus id="metrics-list-notice" tone="info" text={list.notice} />}
    {render(list.items)}
    {list.moreFailure && <ActionStatus id="metrics-list-more" tone="error" text={failureMessage(list.moreFailure, "la lista")} />}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{`${plural(list.items.length, "fila", "filas")} · más recientes primero`}</span>
      {list.hasMore && <Button type="button" variant="outline" className="min-h-10" disabled={list.loadingMore} onClick={() => void list.loadMore()}>{list.loadingMore && <Spinner data-icon="inline-start" />}Cargar más</Button>}
    </div>
  </div>;
}

export function VacancyList({ filters, title = "Vacantes del periodo" }: { filters: MetricsFilters; title?: string }) {
  const list = usePagedList(listVacanciesAction, filters);
  const [target, setTarget] = useState<AuditedTarget | null>(null);
  return <OpenContext.Provider value={setTarget}>
    <ListBody list={list} empty={<SectionEmpty icon={BriefcaseBusiness} tone="empty" title="No hay vacantes en este periodo" description="Ninguna vacante publicada tuvo asignación, cierre o entrega en el periodo elegido." />}
      render={items => <RichDataTable id="company-metrics-vacancies" columns={vacancyColumns} data={items} getRowId={row => row.draft_id} defaultPinning={{ start: ["title"], end: ["actions"] }} emptyState={null} compactControls />} />
    <p className="text-xs text-muted-foreground">{`${title}: sin datos personales. Los nombres de candidatos se abren aparte y esa consulta queda registrada en Auditoría.`}</p>
    <AuditedDetailSheet target={target} onClose={() => setTarget(null)} />
  </OpenContext.Provider>;
}
function ReassignmentList({ filters }: { filters: MetricsFilters }) {
  const list = usePagedList(listReassignmentsAction, filters);
  return <ListBody list={list} empty={<SectionEmpty icon={Repeat} tone="empty" title="No hubo reasignaciones en este periodo" description="Ninguna vacante cambió de responsable en el periodo elegido." />}
    render={items => <RichDataTable id="company-metrics-reassignments" columns={reassignmentColumns} data={items} getRowId={row => row.id} defaultPinning={{ start: ["performed_at"], end: [] }} emptyState={null} compactControls />} />;
}

/** Detail lists of §3.4 below the recruiter table; the reassignments tab reads only once it is opened. */
export function DetailLists({ filters }: { filters: MetricsFilters }) {
  return <Card role="region" aria-label="Detalle del periodo" className="min-w-0">
    <CardHeader><CardTitle><h2>Detalle del periodo</h2></CardTitle><CardDescription>Cada vacante y cada reasignación que entra en los números de arriba.</CardDescription></CardHeader>
    <CardContent>
      <Tabs defaultValue="vacancies" className="min-w-0">
        <TabsList variant="line"><TabsTrigger value="vacancies">Vacantes</TabsTrigger><TabsTrigger value="reassignments">Reasignaciones</TabsTrigger></TabsList>
        <TabsContent value="vacancies" className="flex min-w-0 flex-col gap-3 pt-4"><VacancyList filters={filters} /></TabsContent>
        <TabsContent value="reassignments" className="min-w-0 pt-4"><ReassignmentList filters={filters} /></TabsContent>
      </Tabs>
    </CardContent>
  </Card>;
}
