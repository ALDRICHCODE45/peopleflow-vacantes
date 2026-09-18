"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

// Deterministic fictional recruiting fixture: applications received per day,
// split by origin. Weekdays carry the inflow and weekends drop off; the final
// week totals the 42 candidates the KPI cards report for the current week.
export const chartData = [
  { date: "2024-04-01", directas: 4, referidas: 2 },
  { date: "2024-04-02", directas: 4, referidas: 2 },
  { date: "2024-04-03", directas: 4, referidas: 2 },
  { date: "2024-04-04", directas: 4, referidas: 2 },
  { date: "2024-04-05", directas: 4, referidas: 1 },
  { date: "2024-04-06", directas: 2, referidas: 0 },
  { date: "2024-04-07", directas: 2, referidas: 0 },
  { date: "2024-04-08", directas: 4, referidas: 2 },
  { date: "2024-04-09", directas: 5, referidas: 2 },
  { date: "2024-04-10", directas: 5, referidas: 2 },
  { date: "2024-04-11", directas: 4, referidas: 2 },
  { date: "2024-04-12", directas: 4, referidas: 1 },
  { date: "2024-04-13", directas: 2, referidas: 0 },
  { date: "2024-04-14", directas: 2, referidas: 0 },
  { date: "2024-04-15", directas: 4, referidas: 2 },
  { date: "2024-04-16", directas: 5, referidas: 2 },
  { date: "2024-04-17", directas: 5, referidas: 2 },
  { date: "2024-04-18", directas: 4, referidas: 2 },
  { date: "2024-04-19", directas: 4, referidas: 1 },
  { date: "2024-04-20", directas: 3, referidas: 0 },
  { date: "2024-04-21", directas: 3, referidas: 0 },
  { date: "2024-04-22", directas: 4, referidas: 2 },
  { date: "2024-04-23", directas: 5, referidas: 2 },
  { date: "2024-04-24", directas: 5, referidas: 2 },
  { date: "2024-04-25", directas: 4, referidas: 2 },
  { date: "2024-04-26", directas: 4, referidas: 1 },
  { date: "2024-04-27", directas: 3, referidas: 0 },
  { date: "2024-04-28", directas: 3, referidas: 0 },
  { date: "2024-04-29", directas: 4, referidas: 2 },
  { date: "2024-04-30", directas: 5, referidas: 2 },
  { date: "2024-05-01", directas: 5, referidas: 2 },
  { date: "2024-05-02", directas: 4, referidas: 2 },
  { date: "2024-05-03", directas: 4, referidas: 1 },
  { date: "2024-05-04", directas: 3, referidas: 0 },
  { date: "2024-05-05", directas: 3, referidas: 0 },
  { date: "2024-05-06", directas: 4, referidas: 2 },
  { date: "2024-05-07", directas: 5, referidas: 2 },
  { date: "2024-05-08", directas: 5, referidas: 2 },
  { date: "2024-05-09", directas: 4, referidas: 2 },
  { date: "2024-05-10", directas: 4, referidas: 1 },
  { date: "2024-05-11", directas: 3, referidas: 0 },
  { date: "2024-05-12", directas: 3, referidas: 0 },
  { date: "2024-05-13", directas: 4, referidas: 2 },
  { date: "2024-05-14", directas: 5, referidas: 2 },
  { date: "2024-05-15", directas: 5, referidas: 2 },
  { date: "2024-05-16", directas: 4, referidas: 2 },
  { date: "2024-05-17", directas: 4, referidas: 1 },
  { date: "2024-05-18", directas: 3, referidas: 0 },
  { date: "2024-05-19", directas: 3, referidas: 0 },
  { date: "2024-05-20", directas: 4, referidas: 2 },
  { date: "2024-05-21", directas: 5, referidas: 2 },
  { date: "2024-05-22", directas: 5, referidas: 2 },
  { date: "2024-05-23", directas: 4, referidas: 2 },
  { date: "2024-05-24", directas: 4, referidas: 2 },
  { date: "2024-05-25", directas: 3, referidas: 0 },
  { date: "2024-05-26", directas: 3, referidas: 0 },
  { date: "2024-05-27", directas: 4, referidas: 2 },
  { date: "2024-05-28", directas: 5, referidas: 2 },
  { date: "2024-05-29", directas: 5, referidas: 2 },
  { date: "2024-05-30", directas: 5, referidas: 2 },
  { date: "2024-05-31", directas: 4, referidas: 2 },
  { date: "2024-06-01", directas: 3, referidas: 0 },
  { date: "2024-06-02", directas: 3, referidas: 0 },
  { date: "2024-06-03", directas: 5, referidas: 2 },
  { date: "2024-06-04", directas: 6, referidas: 2 },
  { date: "2024-06-05", directas: 6, referidas: 2 },
  { date: "2024-06-06", directas: 5, referidas: 2 },
  { date: "2024-06-07", directas: 4, referidas: 2 },
  { date: "2024-06-08", directas: 3, referidas: 0 },
  { date: "2024-06-09", directas: 3, referidas: 0 },
  { date: "2024-06-10", directas: 5, referidas: 2 },
  { date: "2024-06-11", directas: 6, referidas: 2 },
  { date: "2024-06-12", directas: 6, referidas: 2 },
  { date: "2024-06-13", directas: 5, referidas: 2 },
  { date: "2024-06-14", directas: 4, referidas: 2 },
  { date: "2024-06-15", directas: 3, referidas: 0 },
  { date: "2024-06-16", directas: 3, referidas: 0 },
  { date: "2024-06-17", directas: 5, referidas: 2 },
  { date: "2024-06-18", directas: 6, referidas: 2 },
  { date: "2024-06-19", directas: 6, referidas: 2 },
  { date: "2024-06-20", directas: 5, referidas: 2 },
  { date: "2024-06-21", directas: 4, referidas: 2 },
  { date: "2024-06-22", directas: 3, referidas: 0 },
  { date: "2024-06-23", directas: 3, referidas: 0 },
  { date: "2024-06-24", directas: 7, referidas: 3 },
  { date: "2024-06-25", directas: 5, referidas: 2 },
  { date: "2024-06-26", directas: 6, referidas: 2 },
  { date: "2024-06-27", directas: 5, referidas: 2 },
  { date: "2024-06-28", directas: 4, referidas: 1 },
  { date: "2024-06-29", directas: 2, referidas: 1 },
  { date: "2024-06-30", directas: 1, referidas: 1 },
]

// Reference desktop tick set, in the reference order.
//
// The screenshot-era source leaves the x-axis to the automatic tick algorithm,
// whose output depends on the measured chart width: the same data renders a
// different label set before and after the container settles. Pinning the
// reference set makes the settled desktop render deterministic while leaving
// `minTickGap` to prune overlapping labels at narrower widths.
const DESKTOP_TICKS = [
  "2024-04-03",
  "2024-04-09",
  "2024-04-15",
  "2024-04-21",
  "2024-04-27",
  "2024-05-03",
  "2024-05-09",
  "2024-05-15",
  "2024-05-21",
  "2024-05-28",
  "2024-06-03",
  "2024-06-09",
  "2024-06-15",
  "2024-06-21",
  "2024-06-29",
]

// Spanish subtitle per selected range. The long form is the desktop copy and the
// short form the narrow-card copy; both stay inside the approved header height.
const RANGE_SUBTITLES: Record<string, { long: string; short: string }> = {
  "90d": { long: "Reparto de los últimos 3 meses", short: "Últimos 3 meses" },
  "30d": { long: "Reparto de los últimos 30 días", short: "Últimos 30 días" },
  "7d": { long: "Reparto de los últimos 7 días", short: "Últimos 7 días" },
}

const chartConfig = {
  directas: {
    label: "Directas",
    color: "var(--primary)",
  },
  referidas: {
    label: "Referidas",
    // Canonical decorative lavender: keeps the second series distinguishable
    // from the violet `--primary` used by Directas, in both themes.
    color: "var(--brand-decorative-strong)",
  },
} satisfies ChartConfig

/**
 * Formats an axis data date ("2024-04-03") for the x-axis label.
 *
 * The data dates are UTC-midnight ISO days. Formatting them in the host time
 * zone shifts every label one day earlier west of UTC — on America/Mexico_City
 * (UTC-6) `2024-04-03` renders as "2 abr" — so the time zone is pinned to UTC to
 * keep the labels identical in every environment.
 */
export function formatTickLabel(value: string): string {
  return new Date(value).toLocaleDateString("es", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** Formats a tooltip date label in Spanish, pinned to UTC for the same reason. */
function formatTooltipLabel(value: React.ReactNode): string {
  return new Date(String(value)).toLocaleDateString("es", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2024-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  const subtitle = RANGE_SUBTITLES[timeRange] ?? RANGE_SUBTITLES["90d"]

  return (
    <Card className="@container/card" data-pf-chart-card="">
      <CardHeader>
        <CardTitle>
          {/* The full heading is the desktop copy. Below the card's 540px
              breakpoint it wrapped onto a second 24px line and pushed the mobile
              chart down to 406px, so the concise title keeps the header on one
              line at the accepted 382px. Both titles share the single title
              slot, so the heading structure and the header layout are unchanged. */}
          <span className="hidden @[540px]/card:inline">
            Origen de las postulaciones
          </span>
          <span className="@[540px]/card:hidden">Postulaciones</span>
        </CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">{subtitle.long}</span>
          <span className="@[540px]/card:hidden">{subtitle.short}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d")
            }}
            variant="outline"
            spacing={0}
            className="hidden w-88 *:data-[slot=toggle-group-item]:flex-1 *:data-[slot=toggle-group-item]:px-[13px]! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Últimos 3 meses</ToggleGroupItem>
            <ToggleGroupItem value="30d">Últimos 30 días</ToggleGroupItem>
            <ToggleGroupItem value="7d">Últimos 7 días</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Seleccionar período"
            >
              <SelectValue placeholder="Últimos 3 meses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Últimos 3 meses
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Últimos 30 días
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Últimos 7 días
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillDirectas" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-directas)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-directas)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillReferidas" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-referidas)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-referidas)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              ticks={DESKTOP_TICKS}
              interval={0}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatTickLabel}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={formatTooltipLabel}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="referidas"
              type="natural"
              fill="url(#fillReferidas)"
              stroke="var(--color-referidas)"
              stackId="a"
            />
            <Area
              dataKey="directas"
              type="natural"
              fill="url(#fillDirectas)"
              stroke="var(--color-directas)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
