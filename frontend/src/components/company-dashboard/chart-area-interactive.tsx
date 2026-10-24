"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { useIsMobile } from "@/hooks/use-mobile"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Dashboard } from "@/features/employer-dashboard/model"

const RANGE_SUBTITLES: Record<string, { long: string; short: string }> = {
  "90d": { long: "Reparto de los últimos 3 meses", short: "Últimos 3 meses" },
  "30d": { long: "Reparto de los últimos 30 días", short: "Últimos 30 días" },
  "7d": { long: "Reparto de los últimos 7 días", short: "Últimos 7 días" },
}
const chartConfig = {
  organic: { label: "Orgánicas", color: "var(--primary)" },
  manual: { label: "Manuales", color: "var(--brand-decorative-strong)" },
} satisfies ChartConfig

// These are already Mexico business days, not instants: UTC preserves the date.
export function formatTickLabel(value: string): string {
  return new Date(value).toLocaleDateString("es", { month: "short", day: "numeric", timeZone: "UTC" })
}
function formatTooltipLabel(value: React.ReactNode): string {
  return formatTickLabel(String(value))
}
export function ChartAreaInteractive({ data }: { data: Dashboard["origin_by_day"] }) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")
  React.useEffect(() => { if (isMobile) setTimeRange("7d") }, [isMobile])
  // The endpoint supplies consecutive, zero-filled days ending on its local today.
  const filteredData = data.slice(-Number.parseInt(timeRange, 10))
  const subtitle = RANGE_SUBTITLES[timeRange] ?? RANGE_SUBTITLES["90d"]
  return (
    <Card className="@container/card" data-pf-chart-card="">
      <CardHeader>
        <CardTitle><h2>
          <span className="hidden @[540px]/card:inline">Origen de las postulaciones</span>
          <span className="@[540px]/card:hidden">Postulaciones</span>
        </h2></CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">{subtitle.long}</span>
          <span className="@[540px]/card:hidden">{subtitle.short}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value: string[]) => { setTimeRange(value[0] ?? "90d") }}
            variant="outline"
            spacing={0}
            className="hidden w-88 *:data-[slot=toggle-group-item]:flex-1 *:data-[slot=toggle-group-item]:px-[13px]! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Últimos 3 meses</ToggleGroupItem>
            <ToggleGroupItem value="30d">Últimos 30 días</ToggleGroupItem>
            <ToggleGroupItem value="7d">Últimos 7 días</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={(value: string | null) => { if (value !== null) setTimeRange(value) }}
            items={Object.entries(RANGE_SUBTITLES).map(([value, copy]) => ({ value, label: copy.short }))}>
            <SelectTrigger className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden" size="sm" aria-label="Seleccionar período">
              <SelectValue placeholder="Últimos 3 meses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectGroup>
                <SelectItem value="90d" className="rounded-lg">Últimos 3 meses</SelectItem>
                <SelectItem value="30d" className="rounded-lg">Últimos 30 días</SelectItem>
                <SelectItem value="7d" className="rounded-lg">Últimos 7 días</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillOrganic" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-organic)" stopOpacity={1.0} />
                <stop offset="95%" stopColor="var(--color-organic)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="fillManual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-manual)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-manual)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={formatTickLabel} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={formatTooltipLabel} indicator="dot" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area dataKey="manual" type="monotone" fill="url(#fillManual)" stroke="var(--color-manual)" stackId="a" />
            <Area dataKey="organic" type="monotone" fill="url(#fillOrganic)" stroke="var(--color-organic)" stackId="a" />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
