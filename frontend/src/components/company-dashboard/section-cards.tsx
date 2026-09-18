"use client"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { IconTrendingUp } from "@tabler/icons-react"

// Fictional recruiting snapshot for the approved prototype. The fourth card's
// trend line is the one the measured stylesheet pins to a single line, so it
// carries the semantic growth marker instead of the context line below it.
const kpiCards = [
  {
    label: "Vacantes activas",
    value: "12",
    trend: "+2",
    trendLine: "En alza este mes",
    context: "3 publicadas esta semana",
  },
  {
    label: "Candidatos nuevos",
    value: "42",
    trend: "+18",
    trendLine: "Buen ritmo de entrada",
    context: "Esperan tu primera revisión",
  },
  {
    label: "En revisión",
    value: "28",
    trend: "+5",
    trendLine: "Revisión al alza",
    context: "Avanzando en tu pipeline",
  },
  {
    label: "Contrataciones este mes",
    value: "3",
    trend: "+1",
    trendLine: "Sumando incorporaciones",
    context: "Tasa de cierre del 11%",
  },
] as const

export function SectionCards() {
  return (
    <div
      data-pf-kpi-cards=""
      className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card"
    >
      {kpiCards.map((kpi, index) => (
        <Card key={kpi.label} className="@container/card">
          <CardHeader>
            <CardDescription>{kpi.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {kpi.value}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <IconTrendingUp />
                {kpi.trend}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div
              data-pf-growth-footer={index === kpiCards.length - 1 ? "" : undefined}
              className="line-clamp-1 flex gap-2 font-medium"
            >
              {kpi.trendLine} <IconTrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">{kpi.context}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
