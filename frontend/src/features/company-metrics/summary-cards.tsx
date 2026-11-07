"use client";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { BriefcaseBusiness, Building2, Globe, PackageCheck, Repeat, UserCheck } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accentIconTile } from "@/lib/accent";
import { cn } from "@/lib/utils";
import type { DefinitionKey } from "./definitions";
import { DefinitionHelp, Legend, RateStat, SegmentedBar, segmentsLabel, Stat, type Segment } from "./metric-parts";
import {
  formatMedian, monthLabel, number, plural, REASSIGNMENT_REASON_LABEL, requesterKindLabel, requesterLabel, share,
  shortMonthLabel, type MetricsSummary,
} from "./model";

function MetricCard({ title, icon: Icon, metric, children, className }: { title: string; icon: ComponentType<SVGProps<SVGSVGElement>>; metric?: DefinitionKey; children: ReactNode; className?: string }) {
  return <Card role="region" aria-label={title} className={cn("min-w-0", className)}>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><span aria-hidden="true" className={cn("grid size-8 place-items-center rounded-full", accentIconTile)}><Icon className="size-4" /></span><h3>{title}</h3></CardTitle>
      {metric && <CardAction className="-my-2"><DefinitionHelp metric={metric} /></CardAction>}
    </CardHeader>
    <CardContent className="flex flex-col gap-4">{children}</CardContent>
  </Card>;
}

const closedSegments = (closed: Pick<MetricsSummary["vacancies"]["closed"], "filled" | "cancelled" | "other" | "no_reason">): Segment[] => [
  { label: "Cubiertas", value: closed.filled, tone: "success" },
  { label: "Canceladas", value: closed.cancelled, tone: "danger" },
  { label: "Otro motivo", value: closed.other, tone: "review" },
  { label: "Sin motivo", value: closed.no_reason, tone: "muted" },
];

function VacanciesCard({ vacancies }: { vacancies: MetricsSummary["vacancies"] }) {
  const segments = closedSegments(vacancies.closed);
  const closed = segments.reduce((sum, segment) => sum + segment.value, 0);
  const target = vacancies.closing_target;
  return <MetricCard title="Vacantes" icon={BriefcaseBusiness}>
    <div className="grid grid-cols-2 gap-4">
      <Stat label="Asignadas" metric="assigned" value={number.format(vacancies.assigned)} />
      <Stat label="Cerradas" metric="closed" value={number.format(closed)} />
    </div>
    <SegmentedBar segments={segments} label={segmentsLabel("Vacantes cerradas por motivo", segments)} />
    <Legend segments={segments} />
    <div className="grid grid-cols-2 gap-4 border-t pt-4">
      <Stat label="Tiempo mediano a cierre" metric="time_to_close" value={formatMedian(vacancies.median_business_days_to_close)} />
      {/* No closing-target rate exists in the contract: the counts are shown as they are. */}
      <Stat label="Cierre en tiempo" metric="closing_target" value={number.format(target.on_time)} detail={`${plural(target.late, "tarde", "tarde")} · ${number.format(target.no_target)} sin objetivo de cierre`} />
    </div>
  </MetricCard>;
}

function DeliveryCard({ delivery }: { delivery: MetricsSummary["delivery"] }) {
  const segments: Segment[] = [
    { label: "A tiempo", value: delivery.on_time, tone: "success" },
    { label: "Tarde", value: delivery.late, tone: "review" },
    { label: "Vencidas", value: delivery.overdue, tone: "danger" },
    { label: "Pendientes", value: delivery.pending, tone: "info" },
  ];
  return <MetricCard title="Entregas de candidatos" icon={PackageCheck} metric="delivery">
    <div className="grid grid-cols-2 gap-4">
      <RateStat label="A tiempo" metric="on_time_rate" rate={delivery.on_time_rate} noun="juzgadas" />
      <RateStat label="Con entrega configurada" metric="configured_rate" rate={delivery.configured_rate} noun="vacantes" />
    </div>
    <SegmentedBar segments={segments} label={segmentsLabel("Entregas", segments)} />
    <Legend segments={segments} />
    <p className="text-xs text-muted-foreground">{`Además, ${plural(delivery.not_configured, "vacante", "vacantes")} sin entrega configurada. Las pendientes aún no se juzgan.`}</p>
    <div className="grid grid-cols-2 gap-4 border-t pt-4">
      <Stat label="Mediana a la meta" metric="time_to_target" value={formatMedian(delivery.median_business_days_to_target)} />
      <Stat label="Candidatos entregados" metric="delivered" value={number.format(delivery.delivered)} />
    </div>
  </MetricCard>;
}

function PlacementsCard({ placements }: { placements: MetricsSummary["placements"] }) {
  const coverage = share(placements.positions_covered, placements.positions_required);
  return <MetricCard title="Placements" icon={UserCheck} metric="placements">
    <Stat label="Contrataciones en el periodo" metric="placements" value={number.format(placements.credits)}
      detail={`De ellas, ${plural(placements.did_not_hold, "no se sostuvo", "no se sostuvieron")}`} />
    <div className="flex flex-col gap-2 border-t pt-4">
      <Stat label="Cobertura de posiciones" metric="coverage" value={coverage ?? "Sin datos suficientes"} detail={`${number.format(placements.positions_covered)} de ${plural(placements.positions_required, "posición", "posiciones")}`} />
      <Progress aria-label="Posiciones cubiertas" value={placements.positions_required ? Math.min(100, (placements.positions_covered / placements.positions_required) * 100) : 0} />
    </div>
  </MetricCard>;
}

function ClosedByMonthCard({ months }: { months: MetricsSummary["closed_by_month"] }) {
  const max = Math.max(1, ...months.map(month => month.filled + month.cancelled + month.other + month.no_reason));
  return <MetricCard title="Vacantes cerradas por mes" icon={BriefcaseBusiness} metric="closed_by_month" className="lg:col-span-2">
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {months.map(month => {
        const segments = closedSegments(month);
        const total = segments.reduce((sum, segment) => sum + segment.value, 0);
        return <li key={month.month} className="grid grid-cols-[4rem_1fr_2rem] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{shortMonthLabel(month.month)}</span>
          <span style={{ width: `${Math.max(2, (total / max) * 100)}%` }}><SegmentedBar segments={segments} label="" /></span>
          <b className="text-right font-medium tabular-nums">{total}</b>
        </li>;
      })}
    </ul>
    <Table>
      <TableCaption className="sr-only">Vacantes cerradas por mes y motivo</TableCaption>
      <TableHeader><TableRow><TableHead scope="col">Mes</TableHead>{closedSegments(months[0] ?? { filled: 0, cancelled: 0, other: 0, no_reason: 0 }).map(segment => <TableHead key={segment.label} scope="col" className="text-right">{segment.label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{months.map(month => <TableRow key={month.month}>
        <TableCell>{monthLabel(month.month)}</TableCell>
        {(["filled", "cancelled", "other", "no_reason"] as const).map(reason => <TableCell key={reason} className="text-right tabular-nums">{month[reason]}</TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
  </MetricCard>;
}

function OriginCard({ origin }: { origin: MetricsSummary["origin"] }) {
  const segments: Segment[] = [
    { label: "Portal de vacantes", value: origin.portal, tone: "primary" },
    { label: "Sitio de empleo", value: origin.careers_site, tone: "info" },
    { label: "Registro manual", value: origin.manual, tone: "review" },
    { label: "Portal o sitio, sin distinguir", value: origin.unknown, tone: "muted" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return <MetricCard title="Origen de las postulaciones" icon={Globe} metric="origin">
    <Stat label="Postulaciones en el periodo" metric="origin" value={number.format(total)} />
    <SegmentedBar segments={segments} label={segmentsLabel("Origen", segments)} />
    <ul className="flex flex-col gap-1 text-sm">{segments.map(segment => <li key={segment.label} className="flex justify-between gap-3">
      <span className="text-muted-foreground">{segment.label}</span>
      <b className="font-medium tabular-nums">{number.format(segment.value)}{share(segment.value, total) && <span className="font-normal text-muted-foreground">{` · ${share(segment.value, total)}`}</span>}</b>
    </li>)}</ul>
    <p className="text-xs text-muted-foreground">Las postulaciones anteriores al registro del canal no distinguen el portal del sitio.</p>
  </MetricCard>;
}

function ReassignmentsCard({ reassignments }: { reassignments: MetricsSummary["reassignments"] }) {
  const reasons = (Object.keys(REASSIGNMENT_REASON_LABEL) as (keyof typeof REASSIGNMENT_REASON_LABEL)[]).map(reason => ({ reason, value: reassignments.by_reason[reason] }));
  const max = Math.max(1, ...reasons.map(item => item.value));
  return <MetricCard title="Reasignaciones" icon={Repeat} metric="reassignments">
    <Stat label="Cambios de responsable" metric="reassignments" value={number.format(reassignments.total)} />
    <ul className="flex flex-col gap-2 text-sm">{reasons.map(({ reason, value }) => <li key={reason} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3">
      <span className="truncate text-muted-foreground">{REASSIGNMENT_REASON_LABEL[reason]}</span>
      <Progress aria-hidden="true" value={(value / max) * 100} />
      <b className="text-right font-medium tabular-nums">{value}</b>
    </li>)}</ul>
  </MetricCard>;
}

function RequesterCard({ rows }: { rows: MetricsSummary["by_requester"] }) {
  return <MetricCard title="Por cliente o área" icon={Building2} metric="by_requester">
    {rows.length === 0 ? <CardDescription>Ninguna vacante del periodo tiene solicitante.</CardDescription> : <Table>
      <TableHeader><TableRow><TableHead scope="col">Cliente o área</TableHead><TableHead scope="col">Tipo</TableHead><TableHead scope="col" className="text-right">Vacantes</TableHead><TableHead scope="col" className="text-right">Cubiertas</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${row.requester?.kind}:${row.requester?.id}:${index}`}>
        <TableCell className="max-w-48 truncate">{requesterLabel(row.requester)}</TableCell>
        <TableCell className="text-muted-foreground">{requesterKindLabel(row.requester?.kind ?? null)}</TableCell>
        <TableCell className="text-right tabular-nums">{row.vacancies}</TableCell>
        <TableCell className="text-right tabular-nums">{row.filled}</TableCell>
      </TableRow>)}</TableBody>
    </Table>}
  </MetricCard>;
}

/** «Resumen de la empresa» of artboard 01: every number with its ⓘ definition, counts as counts, no derived score. */
export function SummaryCards({ summary }: { summary: MetricsSummary }) {
  return <section aria-labelledby="metrics-summary" className="flex min-w-0 flex-col gap-4">
    <h2 id="metrics-summary" className="font-heading text-lg font-semibold">Resumen de la empresa</h2>
    <div className="grid min-w-0 gap-4 lg:grid-cols-3">
      <VacanciesCard vacancies={summary.vacancies} />
      <DeliveryCard delivery={summary.delivery} />
      <PlacementsCard placements={summary.placements} />
      <ClosedByMonthCard months={summary.closed_by_month} />
      <OriginCard origin={summary.origin} />
      <ReassignmentsCard reassignments={summary.reassignments} />
      <RequesterCard rows={summary.by_requester} />
    </div>
  </section>;
}
