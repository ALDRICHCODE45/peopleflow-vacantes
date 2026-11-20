"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarX2, PackageOpen } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { monthLabel, number, plural, share, shortMonthLabel, type ClosuresSection as ClosuresSectionData } from "../model";
import { CHART_ACCENT, CHART_GRID, CHART_MUTED, DELIVERY_TONE, type DeliveryTone } from "../palette";
import { ProcessNote } from "../process-kind";
import { MetricsSection } from "../section";
import type { MetricsFilters } from "../url-state";
import { CARD, drillFor, seeLabel, type Drill } from "./summary-strip";
import type { SectionProps } from "./types";

/** Plot box shared by the month charts: the overlay links below sit exactly over the plotted points. */
/** The x-axis is tall enough for the tick margin and a descender («Ago», «28 ago», «Sep»), which 24 px clipped. */
export const PLOT = { margin: { top: 8, right: 12, bottom: 0, left: 0 }, yAxisWidth: 40, xAxisHeight: 32 } as const;
const lower = (month: string) => monthLabel(month).toLowerCase();
const domId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export type MonthLink = { month: string; href: string | null; label: string };
/**
 * Rule 16 for chart points: one link per month laid over the plot, reachable by keyboard and screen readers. They let
 * the pointer through so the tooltip keeps working; a click on the chart opens the hovered month (`useMonthClick`).
 */
export function MonthLinks({ links, bands = false }: { links: MonthLink[]; /** Bars sit in the middle of equal bands; points sit on the edges. */ bands?: boolean }) {
  if (!links.some(link => link.href)) return null;
  const step = bands ? 100 / links.length : links.length > 1 ? 100 / (links.length - 1) : 100;
  return <div className="pointer-events-none absolute" style={{
    top: PLOT.margin.top, bottom: PLOT.xAxisHeight + PLOT.margin.bottom, left: PLOT.margin.left + PLOT.yAxisWidth, right: PLOT.margin.right,
  }}>
    {links.map((link, index) => {
      if (!link.href) return null;
      const center = bands ? (index + 0.5) * step : links.length > 1 ? index * step : 50;
      const left = Math.max(0, center - step / 2);
      const right = Math.min(100, center + step / 2);
      return <Link key={link.month} href={link.href} aria-label={link.label}
        className="absolute inset-y-0 rounded-md outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
        style={{ left: `${left}%`, width: `${right - left}%` }} />;
    })}
  </div>;
}

/** A click on the chart opens the month under the pointer (the same link as the keyboard overlay). */
export function useMonthClick(links: MonthLink[]) {
  const router = useRouter();
  const hrefs = new Map(links.map(link => [link.month, link.href]));
  const clickable = links.some(link => link.href);
  return {
    clickable,
    onClick: (state: { activeLabel?: string | number } | null) => {
      const href = state?.activeLabel !== undefined ? hrefs.get(String(state.activeLabel)) : null;
      if (href) router.push(href);
    },
  };
}

const closuresConfig = {
  closed: { label: "Cerradas", color: CHART_ACCENT },
  filled: { label: "Cubiertas", color: CHART_MUTED },
} satisfies ChartConfig;

const STATUS: { key: DeliveryTone; label: string; see: (count: number) => string }[] = [
  { key: "on_time", label: "A tiempo", see: count => seeLabel(count, "las", "entrega a tiempo", "entregas a tiempo") },
  { key: "late", label: "Tarde", see: count => seeLabel(count, "las", "entrega tarde", "entregas tarde") },
  { key: "overdue", label: "Vencidas", see: count => seeLabel(count, "las", "entrega vencida", "entregas vencidas") },
  { key: "pending", label: "Pendientes", see: count => seeLabel(count, "las", "entrega pendiente", "entregas pendientes") },
  { key: "not_configured", label: "Sin meta configurada", see: count => seeLabel(count, "las", "vacante sin meta configurada", "vacantes sin meta configurada") },
];

/** «Cierres y entregas» (artboard 07): monthly closures as the main chart (8 columns) beside the delivery status (4). */
export function ClosuresSection({ state, filters, period }: SectionProps<ClosuresSectionData>) {
  const drill = drillFor(filters, period);
  return <MetricsSection title="Cierres y entregas" state={state} help={{ title: "Cómo se calculan cierres y entregas", body: <ClosuresHelp /> }} skeleton={<ClosuresSkeleton />}>
    {data => <div className="grid gap-6 lg:grid-cols-12">
      <ClosuresCard months={data.closed_by_month} drill={drill} filters={filters} />
      <DeliveryStatusCard status={data.delivery_status} drill={drill} />
    </div>}
  </MetricsSection>;
}

function ClosuresCard({ months, drill, filters }: { months: ClosuresSectionData["closed_by_month"]; drill: Drill; filters: MetricsFilters }) {
  const titleId = useId();
  const [asTable, setAsTable] = useState(false);
  const closed = months.reduce((sum, month) => sum + month.closed, 0);
  const filled = months.reduce((sum, month) => sum + month.filled, 0);
  const target = (month?: string, filledOnly = false): Drilldown => ({
    kind: "vacancies", params: { scope: "closed", ...(month ? { closed_month: month } : {}), ...(filledOnly ? { close_reason: "filled" } : {}) },
  });
  const closedLabel = (count: number) => seeLabel(count, "las", "vacante cerrada", "vacantes cerradas");
  const filledLabel = (count: number) => seeLabel(count, "las", "vacante cubierta", "vacantes cubiertas");
  const empty = closed === 0;

  return <article aria-labelledby={titleId} className={cn(CARD, "lg:col-span-8")}>
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 id={titleId} className="text-[15px] leading-[22px] font-semibold">Cierres de vacantes</h3>
        {/* Vacancy level (replacement-processes-v1 «Metrics»): closes are the logical vacancy's own, whatever the process filter says. */}
        <ProcessNote filters={filters} className="mt-1" />
        {!empty && <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2 rounded-full" style={{ background: CHART_ACCENT }} /><span>Cerradas</span>
            <Figure href={drill(target(), closed)} label={closedLabel(closed)} className="font-medium text-foreground tabular-nums">{number.format(closed)}</Figure>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: CHART_MUTED }} /><span>Cubiertas</span>
            <Figure href={drill(target(undefined, true), filled)} label={filledLabel(filled)} className="font-medium text-foreground tabular-nums">{number.format(filled)}</Figure>
          </span>
        </div>}
      </div>
      {!empty && <Button type="button" variant="ghost" className="-mt-2 min-h-10 text-muted-foreground" onClick={() => setAsTable(value => !value)}>
        {asTable ? "Ver como gráfica" : "Ver como tabla"}
      </Button>}
    </div>
    {empty
      ? <SectionEmpty icon={CalendarX2} tone="empty" title="Sin cierres en el periodo" description="Ninguna vacante se cerró entre estas fechas." />
      : asTable
        ? <Table>
          <TableCaption className="sr-only">Vacantes cerradas y cubiertas por mes</TableCaption>
          <TableHeader><TableRow>
            <TableHead scope="col">Mes</TableHead><TableHead scope="col" className="text-right">Cerradas</TableHead><TableHead scope="col" className="text-right">Cubiertas</TableHead>
          </TableRow></TableHeader>
          <TableBody>{months.map(month => <TableRow key={month.month}>
            <TableCell>{monthLabel(month.month)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Figure href={drill(target(month.month), month.closed)} label={`${closedLabel(month.closed)} en ${lower(month.month)}`}>{number.format(month.closed)}</Figure>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Figure href={drill(target(month.month, true), month.filled)} label={`${filledLabel(month.filled)} en ${lower(month.month)}`}>{number.format(month.filled)}</Figure>
            </TableCell>
          </TableRow>)}</TableBody>
        </Table>
        : <ClosuresChart months={months} links={months.map(month => ({
          month: month.month, href: drill(target(month.month), month.closed),
          label: `${closedLabel(month.closed)} en ${lower(month.month)}, ${plural(month.filled, "cubierta", "cubiertas")}`,
        }))} />}
  </article>;
}

function ClosuresChart({ months, links }: { months: ClosuresSectionData["closed_by_month"]; links: MonthLink[] }) {
  const gradient = `closures-${domId(useId())}`;
  const click = useMonthClick(links);
  const peak = months.reduce((best, month) => month.closed > best.closed ? month : best, months[0]);
  const range = months.length > 1 ? `de ${lower(months[0].month)} a ${lower(months[months.length - 1].month)}` : `en ${lower(months[0].month)}`;
  const summary = `Vacantes cerradas y cubiertas por mes, ${range}. ${monthLabel(peak.month)} es el mes con más cierres: ${plural(peak.closed, "cerrada", "cerradas")}, ${plural(peak.filled, "cubierta", "cubiertas")}.`;
  return <div className="relative">
    <div role="img" aria-label={summary}>
      <ChartContainer config={closuresConfig} className={cn("aspect-auto h-[280px] w-full", click.clickable && "cursor-pointer")}>
        <AreaChart data={months} margin={PLOT.margin} accessibilityLayer={false} onClick={click.onClick}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-closed)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-closed)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeDasharray="3 3" />
          <XAxis dataKey="month" height={PLOT.xAxisHeight} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={shortMonthLabel} />
          <YAxis width={PLOT.yAxisWidth} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            content={<ChartTooltipContent indicator="dot" labelFormatter={value => monthLabel(String(value))} />} />
          <Area dataKey="filled" type="monotone" stroke="var(--color-filled)" strokeWidth={1.75} fill="none" isAnimationActive={false} />
          <Area dataKey="closed" type="monotone" stroke="var(--color-closed)" strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
    <MonthLinks links={links} />
  </div>;
}

function DeliveryStatusCard({ status, drill }: { status: ClosuresSectionData["delivery_status"]; drill: Drill }) {
  const titleId = useId();
  const total = STATUS.reduce((sum, { key }) => sum + status[key], 0);
  const target = (result?: DeliveryTone): Drilldown => ({ kind: "deliveries", params: result ? { result } : {} });
  const parts = STATUS.filter(({ key }) => status[key] > 0);
  return <article aria-labelledby={titleId} className={cn(CARD, "lg:col-span-4")}>
    <div>
      <h3 id={titleId} className="text-[15px] leading-[22px] font-semibold">Estado de entregas</h3>
      {total > 0 && <p className="mt-1 text-xs text-muted-foreground">
        <Figure href={drill(target(), total)} label={`${seeLabel(total, "las", "entrega", "entregas")} en el periodo`} className="font-medium">{number.format(total)}</Figure> {total === 1 ? "entrega" : "entregas"} en el periodo
      </p>}
    </div>
    {total === 0
      ? <SectionEmpty icon={PackageOpen} tone="empty" title="Sin entregas en el periodo" description="Ninguna vacante tuvo una entrega de candidatos entre estas fechas." />
      : <>
        <div role="group" aria-label={`Estado de entregas: ${parts.map(({ key, label }) => `${number.format(status[key])} ${label.toLowerCase()}`).join(", ")}`}
          className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {parts.map(({ key, see }) => {
            const href = drill(target(key), status[key]);
            const style = { width: `${(status[key] / total) * 100}%`, background: DELIVERY_TONE[key] };
            return href
              ? <Link key={key} href={href} aria-label={see(status[key])} style={style} className="block h-full outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset" />
              : <span key={key} aria-hidden="true" style={style} className="block h-full" />;
          })}
        </div>
        <ul className="divide-y">
          {STATUS.map(({ key, label, see }) => <li key={key} className="flex min-h-11 items-center gap-3">
            <i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: DELIVERY_TONE[key] }} />
            <span className="flex-1">{label}</span>
            <Figure href={drill(target(key), status[key])} label={see(status[key])} className="min-w-8 text-right font-medium tabular-nums">{number.format(status[key])}</Figure>
            <span className="min-w-10 text-right text-muted-foreground tabular-nums">{share(status[key], total)}</span>
          </li>)}
        </ul>
      </>}
  </article>;
}

function ClosuresHelp() {
  const items: [string, string][] = [
    ["Cierres de vacantes", "Vacantes distintas con un cierre en cada mes; «cubiertas» son las cerradas con motivo cubierta. El mes en curso aún puede cambiar."],
    ["Estado de entregas", "Situación de la entrega de candidatos de cada vacante frente a su fecha meta: a tiempo, tarde, vencida (la fecha pasó sin entregar), pendiente (la fecha aún no llega) o sin meta configurada."],
    ["Ver los registros", "Cada número, segmento y mes abre la lista de vacantes o entregas que lo forman."],
  ];
  return <dl className="flex flex-col gap-3">
    {items.map(([term, text]) => <div key={term}><dt className="font-medium text-foreground">{term}</dt><dd className="mt-1">{text}</dd></div>)}
  </dl>;
}

/** Rule 15: the chart card (8 columns) and the status card (4) with their inner shapes. */
function ClosuresSkeleton() {
  return <div aria-hidden="true" className="grid gap-6 lg:grid-cols-12">
    <div className={cn(CARD, "lg:col-span-8")}>
      <div className="flex justify-between"><div className="flex flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-48" /></div><Skeleton className="h-10 w-28" /></div>
      <Skeleton className="h-[280px] w-full" />
    </div>
    <div className={cn(CARD, "lg:col-span-4")}>
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-40" /></div>
      <Skeleton className="h-3 w-full rounded-full" />
      <div className="flex flex-col gap-3">{[0, 1, 2, 3, 4].map(index => <Skeleton key={index} className="h-8 w-full" />)}</div>
    </div>
  </div>;
}
