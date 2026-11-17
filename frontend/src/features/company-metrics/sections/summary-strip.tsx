"use client";
import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Area, AreaChart, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { countDelta, rateDelta, type Delta } from "../delta";
import { drilldownHref, type Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { formatRate, monthLabel, NO_SAMPLE, number, type MetricsSummary, type MonthRate, type Rate } from "../model";
import type { Period } from "../period";
import { MetricsSection } from "../section";
import type { MetricsFilters } from "../url-state";
import type { SectionProps } from "./types";

/** «Ver las 7 entregas tarde», «Ver 1 entrega tarde»: the accessible name of a drillable figure (rule 16). */
export function seeLabel(count: number, article: "las" | "los", singular: string, pluralNoun: string) {
  return count === 1 ? `Ver 1 ${singular}` : `Ver ${article} ${number.format(count)} ${pluralNoun}`;
}

export type Drill = (target: Drilldown, count?: number) => string | null;
/** The figure's link with the board period and filters; null while the detail page is off or for a 0. */
export function drillFor(filters: MetricsFilters, period: Period): Drill {
  const scope = { ...filters, ...period };
  return (target, count) => drilldownHref(target, scope, { count });
}

/** One container level (rule 4): the card surface with `p-6`, never nested. */
export const CARD = "flex min-w-0 flex-col gap-4 rounded-[min(var(--radius-4xl),24px)] bg-card p-6 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10";

const ON_TIME_UNIVERSE = "on_time,late,overdue";
const TONE: Record<Delta["tone"], string> = {
  // Same tints as the company dashboard (rule 6, artboards 07 and 09): success / danger over a 10% fill.
  positive: "bg-status-success/10 text-status-success",
  negative: "bg-status-danger/10 text-status-danger",
  neutral: "bg-muted text-muted-foreground",
};
// The hero is inverted (foreground canvas): tints mix toward --background so they read in both themes.
const HERO_TONE: Record<Delta["tone"], string> = {
  positive: "bg-[color-mix(in_oklab,var(--status-success)_30%,transparent)] text-[color-mix(in_oklab,var(--status-success)_45%,var(--background))]",
  negative: "bg-[color-mix(in_oklab,var(--status-danger)_30%,transparent)] text-[color-mix(in_oklab,var(--status-danger)_55%,var(--background))]",
  neutral: "bg-background/15 text-background/80",
};
const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

/** Rule 6: the delta pill (arrow + sign) and «vs periodo anterior», which opens the previous period's records. */
function DeltaLine({ delta, previous, hero }: { delta: Delta | null; previous: { href: string | null; label: string }; hero?: boolean }) {
  if (!delta) return null;
  const Arrow = ARROW[delta.direction];
  return <p className={cn("flex flex-wrap items-center gap-2 text-xs", hero ? "text-background/75" : "text-muted-foreground")}>
    <span data-tone={delta.tone} className={cn("inline-flex h-[22px] items-center gap-1 rounded-full px-2 font-medium tabular-nums", (hero ? HERO_TONE : TONE)[delta.tone])}>
      <Arrow aria-hidden="true" className="size-3" strokeWidth={2.5} />
      <span aria-hidden="true">{delta.label}</span>
      <span className="sr-only">{delta.accessible}</span>
    </span>
    {previous.href ? <Figure href={previous.href} label={previous.label}>vs periodo anterior</Figure> : <span aria-hidden="true">vs periodo anterior</span>}
  </p>;
}

const sparkConfig = { rate: { label: "A tiempo", color: "color-mix(in oklab, var(--primary) 55%, var(--background))" } } satisfies ChartConfig;

function Sparkline({ months }: { months: MonthRate[] }) {
  const data = months.map(({ month, rate }) => ({ month, rate: rate.value === null ? null : Math.round(rate.value * 100) }));
  const known = data.filter(point => point.rate !== null);
  if (known.length < 2) return null;
  const [first, last] = [known[0], known[known.length - 1]];
  const label = `Entregas a tiempo por mes: de ${first.rate}% en ${monthLabel(first.month).toLowerCase()} a ${last.rate}% en ${monthLabel(last.month).toLowerCase()}`;
  return <div role="img" aria-label={label} className="mt-auto">
    <ChartContainer config={sparkConfig} className="aspect-auto h-18 w-full" initialDimension={{ width: 320, height: 72 }}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id="summary-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin - 10", "dataMax + 5"]} />
        <Area dataKey="rate" type="monotone" stroke="var(--color-rate)" strokeWidth={2} fill="url(#summary-spark)" isAnimationActive={false} dot={false} activeDot={false} />
      </AreaChart>
    </ChartContainer>
  </div>;
}

function KpiCard({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <article aria-labelledby={id} className={cn(CARD, "gap-3 lg:col-span-4")}>
    <h3 id={id} className="text-sm font-medium text-muted-foreground">{label}</h3>
    {children}
  </article>;
}

const VALUE = "text-[32px] leading-10 font-semibold tracking-tight tabular-nums";
const MISSING = "text-base leading-10 font-medium text-muted-foreground";

/** «Resumen» (artboard 07): the on-time hero spanning two rows, then a 2×2 of headline counts with their change (N1). */
export function SummaryStrip({ state, filters, period }: SectionProps<MetricsSummary>) {
  const drill = drillFor(filters, period);
  return <MetricsSection title="Resumen" state={state} help={{ title: "Cómo se calcula el resumen", body: <SummaryHelp /> }} skeleton={<SummarySkeleton />}>
    {data => <Strip data={data} drill={drill} />}
  </MetricsSection>;
}

function Strip({ data, drill }: { data: MetricsSummary; drill: Drill }) {
  const heroId = useId();
  const headline = data.headline;
  const previousPeriod = headline ? data.previous_period : undefined;
  const rate: Rate = headline?.on_time_rate.current ?? data.delivery.on_time_rate;
  const shown = formatRate(rate);
  const universe: Drilldown = { kind: "deliveries", params: { result: ON_TIME_UNIVERSE } };
  const previousOf = (target: Drilldown): Drilldown => ({ ...target, period: previousPeriod });
  const previousLink = (target: Drilldown, count: number | undefined, label: string) =>
    ({ href: previousPeriod ? drill(previousOf(target), count) : null, label: `${label} del periodo anterior` });

  const assigned = headline?.assigned.current ?? data.vacancies.assigned;
  const median = headline ? headline.median_business_days_to_close.current : data.vacancies.median_business_days_to_close;
  const placements = headline?.placements.current ?? data.placements.credits;
  const reassignments = headline?.reassignments.current ?? data.reassignments.total;
  const filled = data.vacancies.closed.filled;
  const targets = {
    assigned: { kind: "vacancies", params: { scope: "assigned" } },
    median: { kind: "vacancies", params: { scope: "closed", close_reason: "filled", sort: "business_days_to_close" } },
    placements: { kind: "placements", params: {} },
    reassignments: { kind: "reassignments", params: {} },
  } satisfies Record<string, Drilldown>;
  const dueLabel = (count: number) => seeLabel(count, "las", "entrega con fecha cumplida", "entregas con fecha cumplida");

  const counts = [
    { label: "Vacantes asignadas", value: assigned, target: targets.assigned, see: (count: number) => seeLabel(count, "las", "vacante asignada", "vacantes asignadas"),
      delta: headline ? countDelta(headline.assigned) : null, previous: headline?.assigned.previous },
    { label: "Placements", value: placements, target: targets.placements, see: (count: number) => seeLabel(count, "los", "placement", "placements"),
      delta: headline ? countDelta(headline.placements) : null, previous: headline?.placements.previous },
    { label: "Reasignaciones", value: reassignments, target: targets.reassignments, see: (count: number) => seeLabel(count, "las", "reasignación", "reasignaciones"),
      delta: headline ? countDelta(headline.reassignments, "down") : null, previous: headline?.reassignments.previous },
  ];
  const medianDelta = headline ? countDelta(headline.median_business_days_to_close, "down") : null;
  const countCard = ({ label, value, target, see, delta, previous }: (typeof counts)[number]) => <KpiCard key={label} label={label}>
    <p className={VALUE}><Figure href={drill(target, value)} label={see(value)}>{number.format(value)}</Figure></p>
    <DeltaLine delta={delta} previous={previousLink(target, previous, see(previous ?? 0))} />
  </KpiCard>;

  return <div className="grid grid-cols-2 gap-6 lg:grid-cols-12">
    <article aria-labelledby={heroId} className={cn(CARD, "pf-kpi-hero col-span-2 gap-3 bg-foreground text-background shadow-none ring-0 lg:col-span-4 lg:row-span-2")}>
      <h3 id={heroId} className="text-sm font-medium text-background/75">Entregas a tiempo</h3>
      {rate.value === null
        ? <p className={cn(MISSING, "text-background/75")}>{NO_SAMPLE}</p>
        : <p className="text-[44px] leading-[52px] font-semibold tracking-tight tabular-nums">
          <Figure href={drill(universe, rate.denominator)} label={`${dueLabel(rate.denominator)}, ${shown.value} a tiempo`}>{shown.value}</Figure>
        </p>}
      {rate.value !== null && <DeltaLine hero delta={headline ? rateDelta(headline.on_time_rate) : null}
        previous={previousLink(universe, headline?.on_time_rate.previous.denominator, dueLabel(headline?.on_time_rate.previous.denominator ?? 0))} />}
      {data.on_time_by_month && <Sparkline months={data.on_time_by_month} />}
      <p className={cn("text-xs text-background/75", !data.on_time_by_month && "mt-auto")}>
        <Figure href={drill(universe, rate.denominator)} label={`${dueLabel(rate.denominator)}, ${number.format(rate.numerator)} a tiempo`}
          className="font-medium text-background">{shown.detail}</Figure> entregas con fecha cumplida
      </p>
    </article>
    {countCard(counts[0])}
    <KpiCard label="Mediana para cerrar">
      {median === null
        ? <p className={MISSING}>{NO_SAMPLE}</p>
        : <p className={VALUE}>
          <Figure href={drill(targets.median, filled)} label={seeLabel(filled, "las", "vacante cubierta por días para cerrar", "vacantes cubiertas por días para cerrar")}>{number.format(median)}</Figure>
          <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">{median === 1 ? "día hábil" : "días hábiles"}</span>
        </p>}
      {median !== null && <DeltaLine delta={medianDelta && medianDelta.direction !== "flat" ? { ...medianDelta, label: `${medianDelta.label} días` } : medianDelta}
        previous={previousLink(targets.median, undefined, "Ver las vacantes cubiertas por días para cerrar")} />}
    </KpiCard>
    {countCard(counts[1])}
    {countCard(counts[2])}
  </div>;
}

function SummaryHelp() {
  const items: [string, string][] = [
    ["Entregas a tiempo", "Entregas de candidatos hechas en o antes de su fecha meta, entre las que ya llegaron a su fecha (a tiempo, tarde o vencidas)."],
    ["Vacantes asignadas", "Vacantes distintas con un responsable asignado durante el periodo."],
    ["Mediana para cerrar", "Días hábiles entre la apertura y el cierre de la vacante cubierta; la mitad cerró en menos."],
    ["Placements", "Contrataciones con fecha en el periodo. Las anuladas no cuentan."],
    ["Reasignaciones", "Cambios de responsable en el periodo. Sumar o quitar colaboradores no cuenta."],
    ["Comparación y tendencia", "Mismo cálculo en el periodo anterior de igual duración y serie mensual de entregas a tiempo."],
  ];
  return <dl className="flex flex-col gap-3">
    {items.map(([term, text]) => <div key={term}><dt className="font-medium text-foreground">{term}</dt><dd className="mt-1">{text}</dd></div>)}
  </dl>;
}

/** Rule 15: the strip's exact shape, the tall hero and the 2×2. */
function SummarySkeleton() {
  return <div aria-hidden="true" className="grid grid-cols-2 gap-6 lg:grid-cols-12">
    <div className={cn(CARD, "col-span-2 gap-3 lg:col-span-4 lg:row-span-2")}>
      <Skeleton className="h-5 w-32" /><Skeleton className="h-13 w-28" /><Skeleton className="h-5 w-44" />
      <Skeleton className="mt-auto h-18 w-full" /><Skeleton className="h-4 w-52" />
    </div>
    {[0, 1, 2, 3].map(index => <div key={index} className={cn(CARD, "gap-3 lg:col-span-4")}>
      <Skeleton className="h-5 w-32" /><Skeleton className="h-10 w-20" /><Skeleton className="h-5 w-40" />
    </div>)}
  </div>;
}
