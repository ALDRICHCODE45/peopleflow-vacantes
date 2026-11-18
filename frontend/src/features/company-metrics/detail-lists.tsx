"use client";
import { useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, TriangleAlert } from "lucide-react";
import { STACKED_CELL, STACKED_ROW, STACKED_TABLE, STACKED_TITLE } from "@/components/data-table/stacked-table";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { listVacanciesAction } from "./actions";
import { AuditedDetailSheet, type AuditedTarget } from "./audited-detail-sheet";
import type { Drilldown } from "./drilldown";
import { failureMessage } from "./failure";
import {
  CLOSE_REASON_LABEL, dayLabel, DELIVERY_RESULT_LABEL, momentLabel, number, personName, plural, requesterKindLabel,
  requesterLabel, type Person, type VacancyRow,
} from "./model";
import { DELIVERY_TONE } from "./palette";
import { usePagedList, type PagedList } from "./use-paged-list";
import type { MetricsFilters } from "./url-state";

/** A figure's drill-down link (window and «back» already applied); null for a 0. */
type Drill = (target: Drilldown, count: number) => string | null;
const COLUMNS = ["Vacante", "Responsable actual", "Entrega", "Cierre", "Posiciones", "Reasignaciones"] as const;
const FIGURE = "rounded-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring";
const META = "mt-0.5 block text-xs text-muted-foreground";
const personLine = (person: Person | null, fallback: string) => person ? `${personName(person)}${person.former_member ? " · Ex miembro" : ""}` : fallback;
const titleOf = (row: VacancyRow) => row.title?.trim() || "Vacante sin título";

/** The delivery against its current date, in the rule 9 palette (word and dot, never colour alone). */
function DeliveryCell({ row, onOpen }: { row: VacancyRow; onOpen: () => void }) {
  const { delivery } = row;
  if (delivery.result === "not_configured") return <span className="text-muted-foreground">{DELIVERY_RESULT_LABEL.not_configured}</span>;
  const text = delivery.result === "late" && delivery.business_days_late !== null
    ? `${DELIVERY_RESULT_LABEL.late} · ${plural(delivery.business_days_late, "día hábil", "días hábiles")}` : DELIVERY_RESULT_LABEL[delivery.result];
  const count = delivery.target !== null ? `${number.format(delivery.delivered)} de ${number.format(delivery.target)}` : number.format(delivery.delivered);
  const title = titleOf(row);
  return <>
    <Badge variant="outline" className="h-[22px] gap-1.5 bg-card"><i aria-hidden="true" className="size-2 rounded-full" style={{ background: DELIVERY_TONE[delivery.result] }} />{text}</Badge>
    <span className={META}>
      {/* «N de M entregados» names candidates: it opens the audited sheet, never a list. */}
      {delivery.delivered > 0
        ? <button type="button" onClick={onOpen} className={cn(FIGURE, "font-medium text-foreground")} aria-haspopup="dialog"
          aria-label={delivery.delivered === 1 ? `Ver el candidato entregado de ${title}` : `Ver los ${number.format(delivery.delivered)} candidatos entregados de ${title}`}>{count}</button>
        : count}
      {` entregados${delivery.commitment_date ? ` · compromiso ${dayLabel(delivery.commitment_date)}` : ""}`}
    </span>
  </>;
}
function CloseCell({ row }: { row: VacancyRow }) {
  const last = row.closes.at(-1);
  if (!last) return <>Abierta{row.first_published_at && <span className={META}>{`publicada ${momentLabel(row.first_published_at).split(",")[0]}`}</span>}</>;
  return <>{CLOSE_REASON_LABEL[last.reason ?? "no_reason"]}<span className={META}>{dayLabel(last.date)}</span></>;
}
function Count({ href, label, children }: { href: string | null; label: string; children: string }) {
  return href ? <Link href={href} aria-label={label} className={FIGURE}>{children}</Link> : <span>{children}</span>;
}

function ListBody<T>({ list, render, empty }: { list: PagedList<T>; render: (items: T[]) => React.ReactNode; empty: React.ReactNode }) {
  if (list.failure) return <SectionEmpty icon={TriangleAlert} tone="info" title="No pudimos cargar la lista" description={failureMessage(list.failure, "la lista")} primaryAction={{ label: "Reintentar", onClick: list.retry }} />;
  if (!list.items) return <div role="status" aria-label="Cargando la lista" aria-busy="true" className="flex flex-col divide-y">
    {[0, 1, 2, 3].map(index => <div key={index} aria-hidden="true" className="flex h-16 items-center justify-between gap-4"><Skeleton className="h-4 w-56" /><Skeleton className="h-4 w-20" /></div>)}
  </div>;
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

/**
 * «Vacantes con su participación» (artboard 10, rule 12): six columns, no column or row menus, rows below `md`
 * (`stacked-table.ts`). No candidate names: «N de M entregados» opens the audited sheet; positions and reassignments
 * open their detail lists; a 0 stays plain text.
 */
export function VacancyList({ filters, person, drill, vacancyHref }: {
  filters: MetricsFilters; person: string; drill: Drill; vacancyHref: (row: VacancyRow) => string;
}) {
  const list = usePagedList(listVacanciesAction, filters);
  const [target, setTarget] = useState<AuditedTarget | null>(null);
  return <>
    <ListBody list={list} empty={<SectionEmpty icon={BriefcaseBusiness} tone="empty" title="No hay vacantes en este periodo" description="Ninguna vacante publicada tuvo asignación, cierre o entrega en el periodo elegido." />}
      render={items => <Table className={STACKED_TABLE}>
        <TableCaption className="sr-only">{`Vacantes asignadas a ${person} en el periodo`}</TableCaption>
        <TableHeader className="[&_tr]:border-0"><TableRow className="hover:bg-transparent">
          {COLUMNS.map((label, index) => <TableHead key={label} scope="col" className={cn("h-auto pb-3 text-xs text-muted-foreground", index === 0 && "pl-0", index >= 4 && "text-right", index === 5 && "pr-0")}>{label}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody className="[&_tr]:border-t [&_tr]:border-b-0">{items.map(row => {
          const title = titleOf(row);
          const { covered, required } = row.placements;
          return <TableRow key={row.draft_id} className={STACKED_ROW}>
            <TableCell className={cn("h-16 pl-0 whitespace-normal", STACKED_TITLE)}>
              <Link href={vacancyHref(row)} aria-label={`Abrir vacante ${title}`} className="rounded-sm font-medium text-primary-text underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring">{title}</Link>
              <span className={META}>{`${requesterLabel(row.requester)} · ${requesterKindLabel(row.requester?.kind ?? null)}`}</span>
            </TableCell>
            <TableCell data-label={COLUMNS[1]} className={cn("h-16", !row.responsible && "text-muted-foreground", STACKED_CELL)}>{personLine(row.responsible, "Sin responsable")}</TableCell>
            <TableCell data-label={COLUMNS[2]} className={cn("h-16", STACKED_CELL)}><DeliveryCell row={row} onOpen={() => setTarget({ report: "deliveries", vacancy: row })} /></TableCell>
            <TableCell data-label={COLUMNS[3]} className={cn("h-16", STACKED_CELL)}><CloseCell row={row} /></TableCell>
            <TableCell data-label={COLUMNS[4]} className={cn("h-16 text-right tabular-nums", STACKED_CELL)}>
              <Count href={drill({ kind: "placements", params: { vacancy_id: row.draft_id } }, covered)}
                label={`${number.format(covered)} de ${number.format(required)} posiciones: ver los placements de ${title}`}>{`${number.format(covered)} de ${number.format(required)}`}</Count>
            </TableCell>
            <TableCell data-label={COLUMNS[5]} className={cn("h-16 pr-0 text-right tabular-nums", STACKED_CELL)}>
              <Count href={drill({ kind: "reassignments", params: { vacancy_id: row.draft_id } }, row.reassignments)}
                label={row.reassignments === 1 ? `Ver la 1 reasignación de ${title}` : `Ver las ${number.format(row.reassignments)} reasignaciones de ${title}`}>{number.format(row.reassignments)}</Count>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>} />
    <AuditedDetailSheet target={target} period={filters} onClose={() => setTarget(null)} />
  </>;
}
