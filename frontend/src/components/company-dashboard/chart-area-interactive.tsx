"use client";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Dashboard } from "@/features/employer-dashboard/model";
/** Distinct hues in both themes: brand violet for organic, info blue for manual (both used to be violet). */
export const SERIES_COLORS = { organic: "var(--brand-decorative-strong)", manual: "var(--status-info)" } as const;
const config = { organic: { label: "Orgánicas", color: SERIES_COLORS.organic }, manual: { label: "Manuales", color: SERIES_COLORS.manual } } satisfies ChartConfig;
const ranges = [{ value: "90", label: "Últimos 3 meses" }, { value: "30", label: "Últimos 30 días" }, { value: "7", label: "Últimos 7 días" }];
export function formatTickLabel(value: string) { return new Date(value).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }); }
export function ChartAreaInteractive({ data }: { data: Dashboard["origin_by_day"] }) {
  const [range, setRange] = useState("90");
  return <Card className="@container/card" data-pf-chart-card=""><CardHeader>
    <CardTitle><h2>Origen de las postulaciones</h2></CardTitle>
    <CardDescription>Orgánicas: postulaciones de candidatos. Manuales: agregados por el equipo.</CardDescription>
    <CardAction>
      <ToggleGroup multiple={false} value={[range]} onValueChange={values => setRange(values[0] ?? "90")} variant="outline" className="hidden @[767px]/card:flex">
        {ranges.map(item => <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      <Select value={range} onValueChange={value => { if (value) setRange(value); }}><SelectTrigger aria-label="Seleccionar período" className="@[767px]/card:hidden"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{ranges.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </CardAction>
  </CardHeader><CardContent>
    <ChartContainer config={config} className="aspect-auto h-[250px] w-full"><AreaChart data={data.slice(-Number(range))}>
      <CartesianGrid vertical={false} /><XAxis dataKey="date" tickFormatter={formatTickLabel} tickLine={false} axisLine={false} minTickGap={32} />
      <ChartTooltip content={<ChartTooltipContent labelFormatter={value => formatTickLabel(String(value))} />} />
      <Area dataKey="organic" type="monotone" stroke="var(--color-organic)" fill="var(--color-organic)" fillOpacity={0.2} />
      <Area dataKey="manual" type="monotone" stroke="var(--color-manual)" fill="var(--color-manual)" fillOpacity={0.2} />
    </AreaChart></ChartContainer>
    <ul data-pf-chart-legend="" className="flex flex-wrap items-center justify-center gap-4 pt-3 text-sm text-muted-foreground">
      {(["organic", "manual"] as const).map(key => <li key={key} className="flex items-center gap-1.5">
        <span data-pf-chart-swatch="" aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: SERIES_COLORS[key] }} />
        {config[key].label}
      </li>)}
    </ul>
  </CardContent></Card>;
}
