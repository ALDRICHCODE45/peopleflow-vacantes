"use client";
import { useState } from "react";
import { ChartNoAxesColumn, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DefinitionKey } from "./definitions";
import { DefinitionHelp, Legend, type Segment } from "./metric-parts";
import { monthLabel, shortMonthLabel, type RecruiterDetail } from "./model";

type Month = RecruiterDetail["by_month"][number];
const TONE_CLASS: Partial<Record<Segment["tone"], string>> = { success: "bg-status-success", review: "bg-status-review", danger: "bg-status-danger", primary: "bg-primary" };
const EMPTY_MONTH: Month = { month: "", assigned: 0, delivery: { on_time: 0, late: 0, overdue: 0 }, placements: 0 };
const deliverySegments = (month: Month): Segment[] => [
  { label: "A tiempo", value: month.delivery.on_time, tone: "success" },
  { label: "Tarde", value: month.delivery.late, tone: "review" },
  { label: "Vencidas", value: month.delivery.overdue, tone: "danger" },
];

/** One small chart per measure, each with its own scale; the table carries the exact values. */
function MonthChart({ title, metric, months, segments, caption }: { title: string; metric: DefinitionKey; months: Month[]; segments: (month: Month) => Segment[]; caption: string }) {
  const totals = months.map(month => segments(month).reduce((sum, segment) => sum + segment.value, 0));
  const max = Math.max(1, ...totals);
  return <figure className="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/50 p-4">
    <h3 className="flex items-center gap-1 text-sm font-medium">{title}<span className="-my-3"><DefinitionHelp metric={metric} /></span></h3>
    <div aria-hidden="true" className="flex h-32 items-end gap-3">
      {months.map((month, index) => <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
        <em className="text-xs not-italic tabular-nums text-muted-foreground">{totals[index]}</em>
        <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-md bg-muted" style={{ height: `${Math.max(4, (totals[index] / max) * 100)}%` }}>
          {segments(month).map(segment => <span key={segment.label} className={TONE_CLASS[segment.tone]} style={{ height: `${totals[index] ? (segment.value / totals[index]) * 100 : 0}%` }} />)}
        </div>
        <span className="text-xs text-muted-foreground">{shortMonthLabel(month.month)}</span>
      </div>)}
    </div>
    <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
  </figure>;
}

/** «Mes a mes» of artboard 05: dense months (zeros included), charts by default and «Ver como tabla». */
export function MonthlySeries({ name, months }: { name: string; months: Month[] }) {
  const [asTable, setAsTable] = useState(false);
  return <Card role="region" aria-label="Mes a mes" className="min-w-0">
    <CardHeader>
      <CardTitle><h2>Mes a mes</h2></CardTitle>
      <CardDescription>La serie trae todos los meses del periodo, también los que quedan en cero. Una vacante cuenta en cada mes en que tuvo tramo, así que los meses no suman el total del periodo.</CardDescription>
      <CardAction><Button type="button" variant="outline" className="min-h-10" aria-pressed={asTable} aria-controls="metrics-monthly" onClick={() => setAsTable(value => !value)}>
        {asTable ? <ChartNoAxesColumn aria-hidden="true" data-icon="inline-start" /> : <Table2 aria-hidden="true" data-icon="inline-start" />}{asTable ? "Ver como gráfica" : "Ver como tabla"}
      </Button></CardAction>
    </CardHeader>
    <CardContent id="metrics-monthly">
      {asTable ? <Table>
        <TableCaption className="sr-only">{`Serie mensual de ${name}`}</TableCaption>
        <TableHeader><TableRow>{["Mes", "Vacantes asignadas", "A tiempo", "Tarde", "Vencidas", "Placements"].map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{months.map(month => <TableRow key={month.month}>
          {[monthLabel(month.month), month.assigned, month.delivery.on_time, month.delivery.late, month.delivery.overdue, month.placements].map((value, index) => <TableCell key={index} className={index ? "tabular-nums" : undefined}>{value}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table> : <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <MonthChart title="Vacantes asignadas" metric="assigned" months={months} segments={month => [{ label: "Asignadas", value: month.assigned, tone: "primary" }]} caption="Una vacante cuenta en cada mes en que tuvo tramo." />
        <div className="flex min-w-0 flex-col gap-2">
          <MonthChart title="Entregas por fecha compromiso" metric="delivery" months={months} segments={deliverySegments} caption="Por mes de la fecha compromiso." />
          <Legend segments={deliverySegments(EMPTY_MONTH).map((segment, index) => ({ ...segment, value: months.reduce((sum, month) => sum + deliverySegments(month)[index].value, 0) }))} />
        </div>
        <MonthChart title="Placements" metric="placements" months={months} segments={month => [{ label: "Placements", value: month.placements, tone: "primary" }]} caption="Por fecha de contratación." />
      </div>}
    </CardContent>
  </Card>;
}
