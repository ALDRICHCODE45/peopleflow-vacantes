"use client";
import { useId, useState } from "react";
import { Inbox } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Figure } from "@/features/company-metrics/figure";
import { number } from "@/features/company-metrics/model";
import { CHART_ACCENT, CHART_MUTED } from "@/features/company-metrics/palette";
import { MetricsSection } from "@/features/company-metrics/section";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import type { SectionState } from "@/features/company-metrics/use-section";
import { cn } from "@/lib/utils";
import type { DashboardDrill, Drill } from "../drilldown";
import { weekdayDay } from "../format";
import type { DashboardWindow, OriginSection } from "../model";
import { CardHead, HelpList } from "../section";
import { ApplicationsChart, chartPoints } from "./applications-chart";

const HELP: [string, string][] = [
  ["Orgánicas", "Postulaciones que llegaron solas por el portal de vacantes, el sitio de carreras o sin canal registrado."],
  ["Manuales", "Personas que tu equipo registró a mano en una vacante."],
  ["Promedio de 7 días", "Con 30 o 90 días, cada punto promedia ese día y los 6 anteriores para mostrar la tendencia; los totales de la leyenda y la tabla son los conteos sin promediar."],
];
/** Contract §3.5: organic is every channel except manual (the d2b applications `channel` filter). */
const ORGANIC_CHANNELS = "portal,careers_site,unknown";
const SINGULAR: Record<string, string> = { orgánicas: "orgánica", manuales: "manual" };
const see = (count: number, kind: "orgánicas" | "manuales", tail: string) => `Ver ${count === 1 ? `1 postulación ${SINGULAR[kind]}` : `las ${number.format(count)} postulaciones ${kind}`} ${tail}`;

/** «Postulaciones» (artboard 09, last): applications per day, organic vs manual; a 7-day trailing average for 30 and 90 days. */
export function ApplicationsSection({ state, window, drill }: { state: SectionState<OriginSection>; window: DashboardWindow; drill: Drill }) {
  return <MetricsSection title="Postulaciones" state={state} help={{ title: "Cómo se calculan las postulaciones", body: <HelpList items={HELP} /> }} skeleton={<ApplicationsSkeleton />}>
    {data => <ApplicationsCard data={data} window={window} drill={drill} />}
  </MetricsSection>;
}

function ApplicationsCard({ data, window, drill }: { data: OriginSection; window: DashboardWindow; drill: Drill }) {
  const headingId = useId();
  const [asTable, setAsTable] = useState(false);
  const days = data.by_day;
  const organic = days.reduce((sum, day) => sum + day.organic, 0);
  const manual = days.reduce((sum, day) => sum + day.manual, 0);
  const averaged = window !== 7 && days.length >= 7;
  const tail = `de los últimos ${window} días`;
  const target = (channel: string, from = data.window.from, to = data.window.to): DashboardDrill => ({ kind: "applications", params: { from, to, channel } });
  const empty = organic + manual === 0;
  const legend = [
    { key: "organic", label: "Orgánicas", total: organic, color: CHART_ACCENT, dot: "size-2", target: target(ORGANIC_CHANNELS), name: "orgánicas" as const },
    { key: "manual", label: "Manuales", total: manual, color: CHART_MUTED, dot: "h-0.5 w-3", target: target("manual"), name: "manuales" as const },
  ];
  return <article aria-labelledby={headingId} className={CARD}>
    <CardHead id={headingId} title="Postulaciones por día"
      caption={<>
        {averaged ? `Últimos ${window} días · promedio diario de 7 días` : `Últimos ${window} días`}
        {!empty && <span className="mt-2 flex flex-wrap items-center gap-4">
          {legend.map(item => <span key={item.key} className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className={cn("rounded-full", item.dot)} style={{ background: item.color }} />{item.label}
            <Figure href={drill({ ...item.target, params: { channel: item.target.params.channel } }, item.total)} label={see(item.total, item.name, tail)}
              className="font-medium text-foreground tabular-nums">{number.format(item.total)}</Figure>
          </span>)}
        </span>}
      </>}
      action={!empty && <Button type="button" variant="ghost" className="-mt-2 min-h-10 text-muted-foreground" onClick={() => setAsTable(value => !value)}>
        {asTable ? "Ver como gráfica" : "Ver como tabla"}
      </Button>} />
    {empty
      ? <SectionEmpty icon={Inbox} tone="empty" title="Sin postulaciones en el periodo" description={`Nadie se postuló ni fue registrado en tus vacantes en los últimos ${window} días.`} />
      : asTable
        ? <DailyTable days={days} drill={drill} target={target} />
        : <ApplicationsChart points={chartPoints(days, averaged)} averaged={averaged} drill={drill} />}
  </article>;
}

/** Rule 8: the same data as a table, raw daily counts, newest first. */
function DailyTable({ days, drill, target }: { days: OriginSection["by_day"]; drill: Drill; target: (channel: string, from?: string, to?: string) => DashboardDrill }) {
  return <Table>
    <TableCaption className="sr-only">Postulaciones orgánicas y manuales por día, conteo diario sin promediar</TableCaption>
    <TableHeader><TableRow>
      <TableHead scope="col">Día</TableHead><TableHead scope="col" className="text-right">Orgánicas</TableHead><TableHead scope="col" className="text-right">Manuales</TableHead>
    </TableRow></TableHeader>
    <TableBody>{[...days].reverse().map(day => <TableRow key={day.date}>
      <TableCell>{weekdayDay(day.date)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <Figure href={drill(target(ORGANIC_CHANNELS, day.date, day.date), day.organic)} label={see(day.organic, "orgánicas", `del ${weekdayDay(day.date)}`)}>{number.format(day.organic)}</Figure>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Figure href={drill(target("manual", day.date, day.date), day.manual)} label={see(day.manual, "manuales", `del ${weekdayDay(day.date)}`)}>{number.format(day.manual)}</Figure>
      </TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

/** Rule 15: the chart card's shape. */
function ApplicationsSkeleton() {
  return <div aria-hidden="true" className={CARD}>
    <div className="flex justify-between"><div className="flex flex-col gap-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-56" /><Skeleton className="h-4 w-48" /></div><Skeleton className="h-10 w-28" /></div>
    <Skeleton className="h-[260px] w-full" />
  </div>;
}

