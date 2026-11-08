"use client";
import { useId } from "react";
import { CalendarCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { SectionEmpty } from "@/components/feedback/state-card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { formatRate, monthLabel, NO_SAMPLE, number, shortMonthLabel, type ComplianceSection as ComplianceSectionData, type MonthRate, type Rate } from "../model";
import { CHART_ACCENT, CHART_GRID } from "../palette";
import { MetricsSection } from "../section";
import { MonthLinks, PLOT, useMonthClick, type MonthLink } from "./closures-section";
import { CARD, drillFor, seeLabel, type Drill } from "./summary-strip";
import type { SectionProps } from "./types";

const lower = (month: string) => monthLabel(month).toLowerCase();
const due = (count: number) => seeLabel(count, "las", "entrega con fecha cumplida", "entregas con fecha cumplida");
const universe = (month?: string): Drilldown => ({ kind: "deliveries", params: { result: "on_time,late,overdue", ...(month ? { commitment_month: month } : {}) } });

const BUCKETS = [
  { key: "up_to_2", label: "Hasta 2 días hábiles", phrase: "hasta 2 días hábiles" },
  { key: "from_3_to_5", label: "3 a 5 días hábiles", phrase: "3 a 5 días hábiles" },
  { key: "over_5", label: "Más de 5 días hábiles", phrase: "más de 5 días hábiles" },
] as const;

/** The period rate from the monthly numerators and denominators (the months cover the whole period, §4.1 N2). */
export function periodRate(months: MonthRate[]): Rate {
  const numerator = months.reduce((sum, { rate }) => sum + rate.numerator, 0);
  const denominator = months.reduce((sum, { rate }) => sum + rate.denominator, 0);
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator };
}

/** «Cumplimiento de entregas» (artboard 07): the period on-time rate with late deliveries by days late, and the monthly line. */
export function ComplianceSection({ state, filters, period }: SectionProps<ComplianceSectionData>) {
  const drill = drillFor(filters, period);
  return <MetricsSection title="Cumplimiento de entregas" state={state} help={{ title: "Cómo se calcula el cumplimiento", body: <ComplianceHelp /> }} skeleton={<ComplianceSkeleton />}>
    {data => <div className="grid gap-6 lg:grid-cols-12">
      <RateCard data={data} drill={drill} />
      <MonthlyCard months={data.on_time_by_month} drill={drill} />
    </div>}
  </MetricsSection>;
}

function RateCard({ data, drill }: { data: ComplianceSectionData; drill: Drill }) {
  const titleId = useId();
  const rate = periodRate(data.on_time_by_month);
  const shown = formatRate(rate);
  const href = drill(universe(), rate.denominator);
  return <article aria-labelledby={titleId} className={cn(CARD, "lg:col-span-6")}>
    <div>
      <h3 id={titleId} className="text-[15px] leading-[22px] font-semibold">Entregas con fecha cumplida</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        <Figure href={href} label={due(rate.denominator)} className="font-medium">{number.format(rate.denominator)}</Figure> entregas en el periodo
      </p>
    </div>
    {rate.value === null
      ? <p className="text-base leading-[52px] font-medium text-muted-foreground">{NO_SAMPLE}</p>
      : <p className="flex flex-wrap items-baseline gap-3">
        <Figure href={href} label={`${due(rate.denominator)}, ${shown.value} a tiempo`} className="text-[44px] leading-[52px] font-semibold tracking-tight tabular-nums">{shown.value}</Figure>
        <span className="text-muted-foreground">a tiempo · <Figure href={href} label={`${due(rate.denominator)}, ${number.format(rate.numerator)} a tiempo`} className="tabular-nums">{shown.detail}</Figure></span>
      </p>}
    <div className="mt-auto flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Entregas tarde por días de retraso</p>
      <ul className="divide-y">
        {BUCKETS.map(({ key, label, phrase }) => {
          const count = data.late_buckets[key];
          return <li key={key} className="flex min-h-10 items-center justify-between gap-4">
            <span>{label}</span>
            <Figure href={drill({ kind: "deliveries", params: { result: "late", late_bucket: key } }, count)}
              label={`${seeLabel(count, "las", "entrega", "entregas")} con ${phrase} de retraso`} className="font-medium tabular-nums">{number.format(count)}</Figure>
          </li>;
        })}
      </ul>
    </div>
  </article>;
}

const monthlyConfig = { rate: { label: "A tiempo", color: CHART_ACCENT } } satisfies ChartConfig;
type Point = { month: string; rate: number | null; numerator: number; denominator: number };

function MonthlyCard({ months, drill }: { months: MonthRate[]; drill: Drill }) {
  const titleId = useId();
  const gradient = `on-time-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const data: Point[] = months.map(({ month, rate }) => ({ month, rate: rate.value === null ? null : Math.round(rate.value * 100), numerator: rate.numerator, denominator: rate.denominator }));
  const links: MonthLink[] = months.map(({ month, rate }) => ({
    month, href: drill(universe(month), rate.denominator),
    label: `${due(rate.denominator)} de ${lower(month)}${rate.value === null ? "" : `, ${formatRate(rate).value} a tiempo`}`,
  }));
  const click = useMonthClick(links);
  const known = data.filter(point => point.rate !== null);
  const range = months.length > 1 ? `${monthLabel(months[0].month)} a ${lower(months[months.length - 1].month)}` : monthLabel(months[0]?.month ?? "");
  const summary = known.length
    ? `Porcentaje de entregas a tiempo por mes, de ${lower(months[0].month)} a ${lower(months[months.length - 1].month)}: de ${known[0].rate}% a ${known[known.length - 1].rate}%.`
    : "";

  return <article aria-labelledby={titleId} className={cn(CARD, "lg:col-span-6")}>
    <div>
      <h3 id={titleId} className="text-[15px] leading-[22px] font-semibold">A tiempo por mes</h3>
      {known.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{range}</p>}
    </div>
    {known.length === 0
      ? <SectionEmpty icon={CalendarCheck} tone="empty" title="Sin entregas con fecha cumplida" description="Ninguna entrega llegó a su fecha meta en este periodo." />
      : <div className="relative mt-auto">
        <div role="img" aria-label={summary}>
          <ChartContainer config={monthlyConfig} className={cn("aspect-auto h-[236px] w-full", click.clickable && "cursor-pointer")}>
            <AreaChart data={data} margin={PLOT.margin} accessibilityLayer={false} onClick={click.onClick}>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={CHART_GRID} strokeDasharray="3 3" />
              <XAxis dataKey="month" height={PLOT.xAxisHeight} tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={shortMonthLabel} />
              <YAxis width={PLOT.yAxisWidth} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} />
              <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                content={<ChartTooltipContent indicator="dot" labelFormatter={value => monthLabel(String(value))}
                  formatter={(_, __, item) => {
                    const point = item.payload as Point;
                    return <span className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">A tiempo</span>
                      <span className="tabular-nums"><b className="font-medium text-foreground">{point.rate}%</b> · {number.format(point.numerator)} de {number.format(point.denominator)}</span>
                    </span>;
                  }} />} />
              <Area dataKey="rate" type="monotone" stroke="var(--color-rate)" strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </div>
        <MonthLinks links={links} />
      </div>}
  </article>;
}

function ComplianceHelp() {
  const items: [string, string][] = [
    ["A tiempo", "Entregas a tiempo entre las entregas con fecha que ya se cumplieron o vencieron (a tiempo + tarde + vencidas). Pendientes y sin meta no cuentan."],
    ["Días de retraso", "Días hábiles entre la fecha meta y la entrega real, sin fines de semana ni días festivos. Una entrega puede llegar tarde con 0 días hábiles si la fecha meta cayó antes de un fin de semana o festivo."],
    ["A tiempo por mes", "Mismo cálculo por mes de la fecha meta."],
  ];
  return <dl className="flex flex-col gap-3">
    {items.map(([term, text]) => <div key={term}><dt className="font-medium text-foreground">{term}</dt><dd className="mt-1">{text}</dd></div>)}
  </dl>;
}

/** Rule 15: two 6-column cards, the rate with its three rows and the monthly line. */
function ComplianceSkeleton() {
  return <div aria-hidden="true" className="grid gap-6 lg:grid-cols-12">
    <div className={cn(CARD, "lg:col-span-6")}>
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-40" /></div>
      <Skeleton className="h-13 w-56" />
      <div className="flex flex-col gap-3"><Skeleton className="h-4 w-52" />{[0, 1, 2].map(index => <Skeleton key={index} className="h-7 w-full" />)}</div>
    </div>
    <div className={cn(CARD, "lg:col-span-6")}>
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-44" /></div>
      <Skeleton className="h-[236px] w-full" />
    </div>
  </div>;
}
