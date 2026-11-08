"use client";
import { Inbox } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { drilldownHref } from "../drilldown";
import { Figure } from "../figure";
import { number, share, type OriginSection as OriginSectionData } from "../model";
import { CHART_ACCENT, CHART_MUTED } from "../palette";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

type Channel = keyof OriginSectionData["by_channel"];
const CHANNEL_LABEL: Record<Channel, string> = {
  portal: "Portal de vacantes", careers_site: "Sitio de carreras", manual: "Registro manual", unknown: "Portal o sitio, sin distinguir",
};
const see = (count: number, tail = "") => `Ver ${count === 1 ? "la 1 postulación" : `las ${number.format(count)} postulaciones`}${tail}`;

/** «Origen de las postulaciones» (artboard 07, last section): applications of the period by channel, sorted bars. */
export function OriginSection({ state, filters, period }: SectionProps<OriginSectionData>) {
  return <MetricsSection title="Origen de las postulaciones" state={state}
    help={{ title: "Cómo se calcula el origen", body: <dl className="flex flex-col gap-3">
      <div className="flex flex-col gap-1"><dt className="font-medium text-foreground">Postulaciones por canal</dt><dd>Postulaciones creadas en el periodo según el canal: portal de vacantes, sitio de carreras o registro manual.</dd></div>
      <div className="flex flex-col gap-1"><dt className="font-medium text-foreground">Sin distinguir</dt><dd>Postulaciones anteriores a que el portal y el sitio de carreras se separaran.</dd></div>
    </dl> }}
    skeleton={<OriginSkeleton />}>
    {data => {
      // Sorted descending (rule 8); a tie keeps the contract order.
      const channels = (Object.keys(CHANNEL_LABEL) as Channel[]).map(channel => ({ channel, value: data.by_channel[channel] })).sort((a, b) => b.value - a.value);
      const total = channels.reduce((sum, item) => sum + item.value, 0);
      const max = channels[0]?.value ?? 0;
      const href = (channel: Channel | null, count: number) => drilldownHref({ kind: "applications", params: channel ? { channel } : {} }, { ...filters, ...period }, { count });
      return <Card className="gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] leading-[22px] font-semibold">Postulaciones por canal</h3>
          {total > 0 && <p className="text-xs text-muted-foreground"><Figure href={href(null, total)} label={see(total)}>{number.format(total)}</Figure> postulaciones en el periodo</p>}
        </div>
        {total === 0 ? <SectionEmpty icon={Inbox} tone="empty" title="Sin postulaciones en este periodo" description="Aquí verás por qué canal llegan las postulaciones." />
          : <ul className="flex flex-col gap-4">
            {channels.map(({ channel, value }, index) => {
              const label = CHANNEL_LABEL[channel];
              const part = share(value, total) ?? "0%";
              return <li key={channel} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 md:grid-cols-[220px_minmax(0,1fr)_120px]">
                <span className="truncate font-medium">{label}</span>
                <span aria-hidden="true" className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-full bg-muted md:col-span-1 md:col-start-2 md:row-start-1">
                  <span data-testid="origin-bar" data-tone={index === 0 ? "accent" : "muted"} className="block h-full rounded-full"
                    style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: index === 0 ? CHART_ACCENT : CHART_MUTED }} />
                </span>
                <span className="text-right tabular-nums md:col-start-3 md:row-start-1">
                  <Figure href={href(channel, value)} label={see(value, ` de ${label}, ${part}`)} className="font-semibold">{number.format(value)}</Figure>
                  <span className="text-muted-foreground">{` · ${part}`}</span>
                </span>
              </li>;
            })}
          </ul>}
      </Card>;
    }}
  </MetricsSection>;
}

/** Rule 15: the skeleton mirrors the one card with its four bars. */
function OriginSkeleton() {
  return <Card aria-hidden="true" className="gap-4 p-6">
    <div className="flex flex-col gap-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-36" /></div>
    <div className="flex flex-col gap-4">{[100, 60, 35, 10].map(width => <div key={width} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 md:grid-cols-[220px_minmax(0,1fr)_120px]">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="col-span-2 row-start-2 h-2.5 rounded-full md:col-span-1 md:col-start-2 md:row-start-1" style={{ width: `${width}%` }} />
      <Skeleton className="h-4 w-20 justify-self-end md:col-start-3 md:row-start-1" />
    </div>)}</div>
  </Card>;
}
