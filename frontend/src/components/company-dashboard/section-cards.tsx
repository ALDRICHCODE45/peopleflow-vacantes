"use client"

import { BriefcaseBusiness, Users, UserPlus, CircleCheck } from "lucide-react"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { Dashboard } from "@/features/employer-dashboard/model"
import { accentIconTile } from "@/lib/accent"
import { cn } from "@/lib/utils"

type Metrics = Pick<Dashboard, "published_vacancies" | "in_process" | "pool_added_last_7_days" | "positions">

export function SectionCards({ data }: { data: Metrics }) {
  const kpiCards = [
    { label: "Vacantes publicadas", value: data.published_vacancies, icon: BriefcaseBusiness, highlight: "Con publicación activa", context: "Visibles para tu cuenta" },
    { label: "Candidatos en proceso", value: data.in_process, icon: Users, highlight: "En etapas de progreso", context: "En tus vacantes publicadas" },
    { label: "Nuevos en la base", value: data.pool_added_last_7_days, icon: UserPlus, highlight: "Últimos 7 días", context: "Base de talento de tu empresa" },
    { label: "Posiciones cubiertas", value: `${data.positions.covered}/${data.positions.required}`, icon: CircleCheck, highlight: "Cubiertas sobre requeridas", context: "En tus vacantes publicadas" },
  ]
  const coverage = data.positions.required > 0 ? Math.min(100, data.positions.covered / data.positions.required * 100) : 0
  return (
    <div
      data-pf-kpi-cards=""
      className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
    >
      {kpiCards.map((kpi, index) => (
        <Card key={kpi.label} className="@container/card">
          <CardHeader>
            <CardDescription>{kpi.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              <h3>{kpi.value}</h3>
            </CardTitle>
            <CardAction>
              <div data-pf-metric-icon="" className={cn("grid size-9 place-items-center rounded-full", accentIconTile)}>
                <kpi.icon aria-hidden="true" className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div
              data-pf-growth-footer={index === kpiCards.length - 1 ? "" : undefined}
              className="line-clamp-1 flex gap-2 font-medium"
            >
              {kpi.highlight} <kpi.icon aria-hidden="true" className="size-4 shrink-0" />
            </div>
            <div className="text-muted-foreground">{kpi.context}</div>
            {index === kpiCards.length - 1 && <Progress aria-label="Posiciones cubiertas" value={coverage} className="w-full" />}
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
