"use client";
import { createContext, useContext, useState } from "react";
import { BriefcaseBusiness, Ellipsis, TriangleAlert } from "lucide-react";
import { RichDataTable, type RichColumnDef } from "@/components/data-table/rich-data-table";
import { TwoLineCell } from "@/components/data-table/truncated-text";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { listVacanciesAction } from "./actions";
import { AuditedDetailSheet, type AuditedTarget } from "./audited-detail-sheet";
import { failureMessage } from "./failure";
import {
  CLOSE_REASON_LABEL, dayLabel, DELIVERY_RESULT_LABEL, momentLabel, number, personName, plural, requesterKindLabel,
  requesterLabel, type Person, type VacancyRow,
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
    <Badge variant={RESULT_TONE[delivery.result]} dot>{delivery.result === "late" && delivery.business_days_late !== null
      ? `${DELIVERY_RESULT_LABEL.late} · ${plural(delivery.business_days_late, "día hábil", "días hábiles")}` : DELIVERY_RESULT_LABEL[delivery.result]}</Badge>
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
    <AuditedDetailSheet target={target} period={filters} onClose={() => setTarget(null)} />
  </OpenContext.Provider>;
}
