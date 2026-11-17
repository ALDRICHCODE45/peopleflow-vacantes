"use client";
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { MonthLinks, PLOT, useMonthClick, type MonthLink } from "@/features/company-metrics/sections/closures-section";
import { CHART_ACCENT, CHART_GRID, CHART_MUTED } from "@/features/company-metrics/palette";
import { plural } from "@/features/company-metrics/model";
import { cn } from "@/lib/utils";
import type { Drill } from "../drilldown";
import { dayRange, shortDay, trailingAverage, weekdayDay } from "../format";
import type { OriginSection } from "../model";

/** One plotted day: raw counts (7 días) or the 7-day average with the raw sums of its week (30 / 90 días). */
export type ChartPoint = { date: string; from: string; organic: number; manual: number; organicSum: number; manualSum: number };
export function chartPoints(days: OriginSection["by_day"], averaged: boolean): ChartPoint[] {
  return averaged ? trailingAverage(days) : days.map(day => ({ ...day, from: day.date, organicSum: day.organic, manualSum: day.manual }));
}

/** About four steps of 1, 2, 2.5 or 5 × 10ⁿ; counts never step by a fraction (2.5 or below 1). */
function niceStep(rough: number, whole: boolean): number {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const steps = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).filter(step => !whole || (Number.isInteger(step) && step >= 1));
  return steps.find(step => step >= rough) ?? (whole ? Math.max(1, Math.ceil(rough)) : 10 * magnitude);
}
/**
 * The y-axis fitted to what the chart plots: raw daily counts take whole ticks, a 7-day average takes decimal ones, and
 * the top tick is the first step at or above the largest value (a 1.7 peak ends at 2, not 4).
 */
export function yScale(points: ChartPoint[], averaged: boolean): { domain: [number, number]; ticks: number[]; allowDecimals: boolean } {
  const whole = !averaged;
  const max = Math.max(0, ...points.flatMap(point => [point.organic, point.manual]));
  if (max === 0) return { domain: [0, 1], ticks: [0, 1], allowDecimals: !whole };
  const step = niceStep(max / 4, whole);
  const count = Math.ceil(max / step - 1e-9);
  const ticks = Array.from({ length: count + 1 }, (_, index) => Number((index * step).toFixed(4)));
  return { domain: [0, ticks[count]], ticks, allowDecimals: !whole };
}

/** Decimals of a tick value (0.25 → 2), at most 4 as the ticks are rounded to. */
const decimalsOf = (value: number) => (String(Number(value.toFixed(4))).split(".")[1] ?? "").length;
/** Every tick with the precision of the finest one: «0 · 0.25 · 0.5 · 0.75 · 1», never a rounded «0.3» or «0.8». */
export function tickFormatter(ticks: number[]): (value: number) => string {
  const format = new Intl.NumberFormat("es-MX", { maximumFractionDigits: Math.max(0, ...ticks.map(decimalsOf)) });
  return value => format.format(value);
}

const config = { organic: { label: "Orgánicas", color: CHART_ACCENT }, manual: { label: "Manuales", color: CHART_MUTED } } satisfies ChartConfig;
const decimal = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("es-MX");
const longDate = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "numeric", month: "long" });
const long = (date: string) => longDate.format(new Date(`${date}T12:00:00Z`));
/** «del 2 al 8 de noviembre», «del 16 de octubre al 8 de noviembre». */
function spanLong(from: string, to: string) {
  const [a, b] = [long(from), long(to)];
  return from.slice(0, 7) === to.slice(0, 7) ? `del ${a.split(" ")[0]} al ${b}` : `del ${a} al ${b}`;
}

/** Area chart (artboard 09): organic is the accent series, manual a muted line; each point opens its records when the lists are on. */
export function ApplicationsChart({ points, averaged, drill }: { points: ChartPoint[]; averaged: boolean; drill: Drill }) {
  const gradient = `applications-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const format = averaged ? decimal : whole;
  const links: MonthLink[] = points.map(point => {
    const total = point.organicSum + point.manualSum;
    const when = averaged ? spanLong(point.from, point.date) : `del ${weekdayDay(point.date)}`;
    return { month: point.date, href: drill({ kind: "applications", params: { from: point.from, to: point.date } }, total),
      label: `${total === 1 ? "Ver 1 postulación" : `Ver las ${whole.format(total)} postulaciones`} ${when}: ${plural(point.organicSum, "orgánica", "orgánicas")} y ${plural(point.manualSum, "manual", "manuales")}` };
  });
  const click = useMonthClick(links);
  const scale = yScale(points, averaged);
  const tick = tickFormatter(scale.ticks);
  const first = points[0];
  const last = points[points.length - 1];
  const summary = averaged
    ? `Gráfica de área: promedio diario de 7 días de postulaciones orgánicas y manuales, ${spanLong(first.date, last.date)}.`
    : `Gráfica de área: Postulaciones orgánicas y manuales por día, ${spanLong(first.date, last.date)}.`;
  return <div className="relative">
    <div role="img" aria-label={summary}>
      <ChartContainer config={config} className={cn("aspect-auto h-[260px] w-full", click.clickable && "cursor-pointer")}>
        <AreaChart data={points} margin={PLOT.margin} accessibilityLayer={false} onClick={click.onClick}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-organic)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-organic)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeDasharray="3 3" />
          <XAxis dataKey="date" height={PLOT.xAxisHeight} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={value => shortDay(String(value))} />
          <YAxis width={PLOT.yAxisWidth} tickLine={false} axisLine={false} domain={scale.domain} ticks={scale.ticks} allowDecimals={scale.allowDecimals}
            tickFormatter={value => tick(Number(value))} />
          <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
              if (!point) return null;
              return <div className="grid min-w-40 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="font-semibold text-foreground">{averaged ? dayRange(point.from, point.date) : weekdayDay(point.date)}</p>
                {averaged && <p className="text-muted-foreground">Promedio al día</p>}
                {(["organic", "manual"] as const).map(key => <p key={key} className="flex items-center gap-2 text-muted-foreground">
                  <i aria-hidden="true" className="size-2 rounded-full" style={{ background: config[key].color }} />
                  {config[key].label} <span className="ml-auto font-semibold text-foreground tabular-nums">{format.format(point[key])}</span>
                </p>)}
              </div>;
            }} />
          <Area dataKey="manual" type="monotone" stroke="var(--color-manual)" strokeWidth={1.75} fill="none" isAnimationActive={false} />
          <Area dataKey="organic" type="monotone" stroke="var(--color-organic)" strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
    <MonthLinks links={links} />
  </div>;
}
