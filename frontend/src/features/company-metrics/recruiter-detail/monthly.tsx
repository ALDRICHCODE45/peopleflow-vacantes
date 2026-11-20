"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { STACKED_CELL, STACKED_ROW, STACKED_TABLE, STACKED_TITLE } from "@/components/data-table/stacked-table";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { monthLabel, number, shortMonthLabel, type RecruiterDetail } from "../model";
import { DELIVERY_TONE } from "../palette";
import type { Period } from "../period";
import { ProcessNote } from "../process-kind";
import { MetricsSection } from "../section";
import { CAPTION, CARD_TITLE, CardSkeleton, HelpList, see, type Drill, type Who } from "./parts";
import type { DetailState } from "./sections";
import { CARD } from "../sections/summary-strip";

type Month = RecruiterDetail["by_month"][number];
type Segment = { key: string; value: number; color: string; href: string | null; label: string };
const NEUTRAL_BAR = "color-mix(in oklab, var(--muted-foreground) 40%, var(--card))";
const longMonth = new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" });
const monthName = (month: string) => longMonth.format(new Date(`${month}-01T12:00:00Z`));
const lowerMonth = (month: string) => monthLabel(month).toLowerCase();
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** The part of the page window inside one month: a month narrows the period for vacancies and placements. */
export function monthWindow(month: string, period: Period): Period {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
  const first = `${month}-01`;
  return { from: first < period.from ? period.from : first, to: last > period.to ? period.to : last };
}

/** «Agosto a octubre de 2026», «· noviembre en curso» when the last month is today's. */
export function monthRange(months: Month[], today: string): string {
  if (!months.length) return "";
  const first = months[0].month, last = months[months.length - 1].month;
  const [firstYear, lastYear] = [first.slice(0, 4), last.slice(0, 4)];
  const range = first === last ? `${capitalize(monthName(first))} de ${firstYear}`
    : firstYear === lastYear ? `${capitalize(monthName(first))} a ${monthName(last)} de ${lastYear}`
      : `${capitalize(monthName(first))} de ${firstYear} a ${monthName(last)} de ${lastYear}`;
  return last === today.slice(0, 7) ? `${range} · ${monthName(last)} en curso` : range;
}

/** Integer ticks only: 0, the middle and the top, the top rounded up to an even number above 1. */
function ticksFor(max: number): number[] {
  const top = max <= 1 ? 1 : max % 2 ? max + 1 : max;
  return top === 1 ? [0, 1] : [0, top / 2, top];
}

/** One small plot (rule 8): bars per month, every bar or segment above 0 a link, a 0 plain text. */
function MonthBars({ title, summary, months, segments, legend }: { title: string; summary: string; months: Month[]; segments: (month: Month) => Segment[]; legend?: Segment[] }) {
  const totals = months.map(month => segments(month).reduce((sum, segment) => sum + segment.value, 0));
  const ticks = ticksFor(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  return <figure className="flex min-w-0 flex-col gap-3">
    <figcaption className="text-sm font-medium">{title}</figcaption>
    <div role="group" aria-label={summary} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
      <div aria-hidden="true" className="relative h-40">
        {ticks.map(tick => <span key={tick} className="absolute right-0 translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ bottom: `${(tick / top) * 100}%` }}>{tick}</span>)}
      </div>
      <div className="relative h-40">
        {ticks.map(tick => <span key={tick} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(tick / top) * 100}%` }} />)}
        <div className="relative flex h-full items-end justify-around gap-2">
          {months.map((month, index) => {
            const total = totals[index];
            return <div key={month.month} className="flex h-full w-full max-w-9 flex-col items-center justify-end gap-1">
              <span aria-hidden="true" className={cn("text-xs tabular-nums", total ? "font-semibold text-foreground" : "text-muted-foreground")}>{number.format(total)}</span>
              <div className="flex w-full flex-col-reverse gap-px overflow-hidden rounded-[4px]" style={{ height: `${(total / top) * 100}%` }}>
                {segments(month).filter(segment => segment.value > 0).map(segment => {
                  const style = { height: `${(segment.value / total) * 100}%`, background: segment.color };
                  return segment.href
                    ? <Link key={segment.key} href={segment.href} aria-label={segment.label} style={style} className="block w-full outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset" />
                    : <span key={segment.key} style={style} className="block w-full" />;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>
      <span aria-hidden="true" />
      <div aria-hidden="true" className="flex justify-around gap-2 pt-2">
        {months.map(month => <span key={month.month} className="w-full max-w-9 text-center text-xs text-muted-foreground">{shortMonthLabel(month.month)}</span>)}
      </div>
    </div>
    {legend && <div aria-hidden="true" className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
      {legend.map(segment => <span key={segment.key} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: segment.color }} />{segment.label}</span>)}
    </div>}
  </figure>;
}

/** «Evolución mensual»: one card, three small plots (each with its own scale) and «Ver como tabla» (rule 8). */
export function MonthlySection({ state, drill, who, period, today, filters = {} }: { state: DetailState; drill: Drill; who: Who; period: Period; today: string; filters?: { process_kind?: string } }) {
  return <MetricsSection title="Evolución mensual" state={state} skeleton={<MonthlySkeleton />} help={{ title: "Cómo se calcula la evolución mensual", body: <HelpList items={[
    ["Meses del periodo", "La serie trae todos los meses del periodo, también los que quedan en cero. El primer y el último mes cuentan solo los días dentro del periodo."],
    ["Vacantes asignadas", "Una vacante cuenta en cada mes en que tuvo tramo, así que los meses no suman el total del periodo."],
    ["Entregas", "Por mes de la fecha compromiso."],
    ["Placements", "Por fecha de contratación."],
  ]} /> }}>
    {data => <MonthlyCard months={data.by_month} drill={drill} who={who} period={period} today={today} filters={filters} />}
  </MetricsSection>;
}

function MonthlyCard({ months, drill, who, period, today, filters }: { months: Month[]; drill: Drill; who: Who; period: Period; today: string; filters: { process_kind?: string } }) {
  const titleId = useId();
  const bodyId = useId();
  const [asTable, setAsTable] = useState(false);
  const cells = monthCells(drill, who, period);
  const deliveries = (month: Month): Segment[] => (["on_time", "late", "overdue"] as const).map(result => cells[result](month));
  const each = (value: (month: Month) => number) => months.map(month => `${lowerMonth(month.month)} ${number.format(value(month))}`).join(", ");
  return <article aria-labelledby={titleId} className={CARD}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div><h3 id={titleId} className={CARD_TITLE}>Actividad por mes</h3>{months.length > 0 && <p className={CAPTION}>{monthRange(months, today)}</p>}
        <ProcessNote filters={filters} className="mt-1">«Vacantes asignadas» no cambia con el filtro de proceso.</ProcessNote></div>
      {months.length > 0 && <Button type="button" variant="ghost" className="-mt-2 min-h-10 text-muted-foreground" aria-pressed={asTable} aria-controls={bodyId} onClick={() => setAsTable(value => !value)}>
        {asTable ? "Ver como gráfica" : "Ver como tabla"}
      </Button>}
    </div>
    <div id={bodyId} className="min-w-0">
      {!months.length ? <SectionEmpty icon={CalendarRange} tone="empty" title="Sin meses en el periodo" description="Elige un periodo para ver la actividad de cada mes." />
        : asTable ? <Table className={STACKED_TABLE}>
          <TableCaption className="sr-only">{`Serie mensual de ${who.name}`}</TableCaption>
          <TableHeader><TableRow className="hover:bg-transparent">{["Mes", "Vacantes asignadas", "A tiempo", "Tarde", "Vencidas", "Placements"].map((label, index) =>
            <TableHead key={label} scope="col" className={cn("text-xs text-muted-foreground", index > 0 && "text-right")}>{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{months.map(month => <TableRow key={month.month} className={STACKED_ROW}>
            <TableHead scope="row" className={cn("h-12 font-medium text-foreground", STACKED_TITLE)}>{monthLabel(month.month)}</TableHead>
            {[["Vacantes asignadas", cells.assigned(month)], ["A tiempo", cells.on_time(month)], ["Tarde", cells.late(month)], ["Vencidas", cells.overdue(month)], ["Placements", cells.placements(month)]].map(([label, segment]) => {
              const { value, href, label: name } = segment as Segment;
              return <TableCell key={label as string} data-label={label as string} className={cn("h-12 text-right tabular-nums", STACKED_CELL)}>
                <Figure href={href} label={name} className={value ? "font-semibold" : undefined}>{number.format(value)}</Figure>
              </TableCell>;
            })}
          </TableRow>)}</TableBody>
        </Table>
          : <div className="grid min-w-0 gap-8 md:grid-cols-3 md:gap-10">
            <MonthBars title="Vacantes asignadas" months={months} segments={month => [cells.assigned(month)]}
              summary={`Vacantes asignadas por mes: ${each(month => month.assigned)}. Cada mes abre sus vacantes.`} />
            <MonthBars title="Entregas por fecha compromiso" months={months} segments={deliveries}
              summary={`Entregas por mes de la fecha compromiso: ${months.map(month => `${lowerMonth(month.month)} ${number.format(month.delivery.on_time)} a tiempo, ${number.format(month.delivery.late)} tarde, ${number.format(month.delivery.overdue)} vencidas`).join("; ")}.`}
              legend={[{ key: "on_time", label: "A tiempo", color: DELIVERY_TONE.on_time }, { key: "late", label: "Tarde", color: DELIVERY_TONE.late }, { key: "overdue", label: "Vencidas", color: DELIVERY_TONE.overdue }].map(item => ({ ...item, value: 0, href: null }))} />
            <MonthBars title="Placements" months={months} segments={month => [cells.placements(month)]}
              summary={`Placements por mes: ${each(month => month.placements)}.`} />
          </div>}
    </div>
  </article>;
}

/**
 * Each monthly figure with its link: vacancies and placements narrow the window to the month; deliveries keep the
 * window and filter by their own `commitment_month` (artboard 10).
 */
function monthCells(drill: Drill, who: Who, period: Period) {
  const delivery = (result: "on_time" | "late" | "overdue", singular: string, pluralNoun: string) => (month: Month): Segment => {
    const value = month.delivery[result];
    const target: Drilldown = { kind: "deliveries", params: { attributed_to: who.id, result, commitment_month: month.month } };
    return { key: result, value, color: DELIVERY_TONE[result], href: drill(target, value), label: `${see(value, "f", singular, pluralNoun)} de ${who.name} con compromiso en ${lowerMonth(month.month)}` };
  };
  return {
    assigned: (month: Month): Segment => ({
      key: "assigned", value: month.assigned, color: NEUTRAL_BAR, label: `${see(month.assigned, "f", "vacante asignada", "vacantes asignadas")} a ${who.name} en ${lowerMonth(month.month)}`,
      href: drill({ kind: "vacancies", params: { scope: "assigned", recruiter_id: who.id }, period: monthWindow(month.month, period) }, month.assigned),
    }),
    on_time: delivery("on_time", "entrega a tiempo", "entregas a tiempo"),
    late: delivery("late", "entrega tarde", "entregas tarde"),
    overdue: delivery("overdue", "entrega vencida", "entregas vencidas"),
    placements: (month: Month): Segment => ({
      key: "placements", value: month.placements, color: NEUTRAL_BAR, label: `${see(month.placements, "m", "placement", "placements")} de ${who.name} en ${lowerMonth(month.month)}`,
      href: drill({ kind: "placements", params: { recipient: who.id }, period: monthWindow(month.month, period) }, month.placements),
    }),
  };
}

/** Rule 15: the card with its title and the three small plots. */
function MonthlySkeleton() {
  return <div aria-hidden="true"><CardSkeleton>
    <div className="grid gap-8 md:grid-cols-3 md:gap-10">{[0, 1, 2].map(index => <div key={index} className="flex flex-col gap-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-48 w-full" /></div>)}</div>
  </CardSkeleton></div>;
}
