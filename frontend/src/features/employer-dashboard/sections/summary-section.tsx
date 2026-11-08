"use client";
import { useId } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Figure } from "@/features/company-metrics/figure";
import { number, share } from "@/features/company-metrics/model";
import { CARD, seeLabel } from "@/features/company-metrics/sections/summary-strip";
import { MetricsSection } from "@/features/company-metrics/section";
import type { SectionState } from "@/features/company-metrics/use-section";
import { DELIVERY_TONE } from "@/features/company-metrics/palette";
import { cn } from "@/lib/utils";
import type { Drill, DashboardDrill } from "../drilldown";
import { shortDay } from "../format";
import type { DashboardWindow, SummarySection as SummaryData } from "../model";
import { HelpList } from "../section";
import { DeltaLine, HERO_VALUE, KpiCard, VALUE } from "./kpi";

const HELP: [string, string][] = [
  ["Candidatos en proceso", "Personas activas en las vacantes publicadas, sin contar Nuevos ni Placement: ya revisadas y aún sin contratar. La línea muestra el total al cierre de cada día."],
  ["Vacantes publicadas", "Vacantes publicadas y abiertas a postulaciones (sin pausar, cerrar ni terminar) al cierre del periodo."],
  ["Nuevos en la base", "Perfiles agregados a la base de talento de toda la empresa en el periodo, por postulación o registro manual. Solo lo ve quien tiene acceso a la base."],
  ["Posiciones cubiertas", "Contrataciones vigentes frente a las posiciones requeridas de las vacantes publicadas hoy."],
  ["Comparación", "Las cifras de hoy se comparan con su valor de hace 7, 30 o 90 días; los nuevos en la base, con el periodo anterior de igual duración."],
];

const target = {
  inProcess: { kind: "candidates", params: { in_process: "true" } },
  published: { kind: "vacancies", params: { status: "published" } },
  positions: { kind: "vacancies", params: { status: "published", sort: "positions_open" } },
} satisfies Record<string, DashboardDrill>;
const inProcessLabel = (count: number) => seeLabel(count, "los", "candidato en proceso", "candidatos en proceso");
const publishedLabel = (count: number) => seeLabel(count, "las", "vacante publicada", "vacantes publicadas");

/** «Resumen» (artboard 09): the in-process hero over two rows, published vacancies, pool additions and covered positions. */
export function SummarySection({ state, window, drill }: { state: SectionState<SummaryData>; window: DashboardWindow; drill: Drill }) {
  return <MetricsSection title="Resumen" state={state} help={{ title: "Cómo se calcula el resumen", body: <HelpList items={HELP} /> }} skeleton={<SummarySkeleton />}>
    {data => <Strip data={data} window={window} drill={drill} />}
  </MetricsSection>;
}

function Strip({ data, window, drill }: { data: SummaryData; window: DashboardWindow; drill: Drill }) {
  const stock = `vs hace ${window} días`;
  const published = data.published_vacancies.current;
  return <div className="grid grid-cols-2 gap-6 lg:grid-cols-12">
    <KpiCard hero label="Candidatos en proceso" className="col-span-2 lg:col-span-4 lg:row-span-2">
      <p className={HERO_VALUE}><Figure href={drill(target.inProcess, data.in_process.current)} label={inProcessLabel(data.in_process.current)}>{number.format(data.in_process.current)}</Figure></p>
      <DeltaLine hero current={data.in_process.current} previous={data.in_process.previous} comparison={stock} />
      <Sparkline series={data.in_process.series} />
      <p className="text-xs text-background/75">
        En <Figure href={drill(target.published, published)} label={publishedLabel(published)} className="font-medium text-background">{plural(published, "vacante", "vacantes")}</Figure> {published === 1 ? "publicada" : "publicadas"}
      </p>
    </KpiCard>
    <KpiCard label="Vacantes publicadas" className={cn("lg:col-span-4", !data.pool_added && "col-span-2 lg:col-span-8")}>
      <p className={VALUE}><Figure href={drill(target.published, published)} label={publishedLabel(published)}>{number.format(published)}</Figure></p>
      <DeltaLine current={published} previous={data.published_vacancies.previous} comparison={stock} />
    </KpiCard>
    {/* Hidden, not zero, without talent-base access (the current dashboard's rule). */}
    {data.pool_added && <KpiCard label="Nuevos en la base" className="lg:col-span-4">
      <p className={VALUE}>
        <Figure href={drill({ kind: "talent_base", params: { added_from: data.window.from, added_to: data.window.to } }, data.pool_added.current)}
          label={seeLabel(data.pool_added.current, "los", "perfil agregado a la base", "perfiles agregados a la base")}>{number.format(data.pool_added.current)}</Figure>
      </p>
      <DeltaLine current={data.pool_added.current} previous={data.pool_added.previous} comparison={`vs ${window} días anteriores`} />
    </KpiCard>}
    <Positions positions={data.positions} drill={drill} />
  </div>;
}

const plural = (count: number, singular: string, pluralForm: string) => `${number.format(count)} ${count === 1 ? singular : pluralForm}`;
const sparkConfig = { value: { label: "En proceso", color: "color-mix(in oklab, var(--primary) 55%, var(--background))" } } satisfies ChartConfig;

function Sparkline({ series }: { series: SummaryData["in_process"]["series"] }) {
  const gradient = `in-process-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [first, last] = [series[0], series[series.length - 1]];
  const label = `Candidatos en proceso por día: de ${number.format(first.value)} el ${shortDay(first.date)} a ${number.format(last.value)} hoy`;
  return <div role="img" aria-label={label} className="mt-auto">
    <ChartContainer config={sparkConfig} className="aspect-auto h-18 w-full" initialDimension={{ width: 320, height: 72 }}>
      <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
        <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} dot={false} activeDot={false} />
      </AreaChart>
    </ChartContainer>
  </div>;
}

/** «19 de 64 posiciones» with the covered / open bar; covered can exceed required, so open never goes below 0. */
function Positions({ positions, drill }: { positions: SummaryData["positions"]; drill: Drill }) {
  const { covered, required } = positions;
  const open = Math.max(required - covered, 0);
  const total = covered + open;
  const coveredLabel = seeLabel(covered, "las", "posición cubierta", "posiciones cubiertas");
  const openLabel = seeLabel(open, "las", "posición por cubrir", "posiciones por cubrir");
  const parts = [
    { key: "covered", label: "Cubiertas", count: covered, see: coveredLabel, tone: DELIVERY_TONE.on_time },
    { key: "open", label: "Por cubrir", count: open, see: openLabel, tone: DELIVERY_TONE.not_configured },
  ];
  return <KpiCard label="Posiciones cubiertas" className="col-span-2 lg:col-span-8">
    <p className={VALUE}>
      <Figure href={drill(target.positions, covered)} label={coveredLabel}>{number.format(covered)}</Figure>
      <small className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">de {plural(required, "posición", "posiciones")}</small>
    </p>
    {required === 0
      ? <p className="mt-auto text-xs text-muted-foreground">Sin posiciones definidas</p>
      : <div className="mt-auto flex flex-col gap-3">
        <div role="group" aria-label={`Posiciones de las vacantes publicadas: ${number.format(covered)} cubiertas, ${number.format(open)} por cubrir`}
          className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {parts.filter(part => part.count > 0).map(part => <span key={part.key} aria-hidden="true" className="block h-full" style={{ width: `${(part.count / total) * 100}%`, background: part.tone }} />)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {parts.map(part => <span key={part.key} className="inline-flex items-center gap-2">
            <i aria-hidden="true" className="size-2 rounded-full" style={{ background: part.tone }} />
            {part.label} <Figure href={drill(target.positions, part.count)} label={part.see} className="font-semibold text-foreground tabular-nums">{number.format(part.count)}</Figure> · {share(part.count, total)}
          </span>)}
        </div>
      </div>}
  </KpiCard>;
}

/** Rule 15: the strip's exact shape, the tall hero, two cards and the wide positions card. */
function SummarySkeleton() {
  return <div aria-hidden="true" className="grid grid-cols-2 gap-6 lg:grid-cols-12">
    <div className={cn(CARD, "col-span-2 gap-3 lg:col-span-4 lg:row-span-2")}>
      <Skeleton className="h-5 w-40" /><Skeleton className="h-13 w-24" /><Skeleton className="h-5 w-36" />
      <Skeleton className="mt-auto h-18 w-full" /><Skeleton className="h-4 w-44" />
    </div>
    {[0, 1].map(index => <div key={index} className={cn(CARD, "gap-3 lg:col-span-4")}>
      <Skeleton className="h-5 w-32" /><Skeleton className="h-10 w-20" /><Skeleton className="h-5 w-40" />
    </div>)}
    <div className={cn(CARD, "col-span-2 gap-3 lg:col-span-8")}>
      <Skeleton className="h-5 w-36" /><Skeleton className="h-10 w-40" /><Skeleton className="mt-auto h-2.5 w-full rounded-full" /><Skeleton className="h-4 w-60" />
    </div>
  </div>;
}
