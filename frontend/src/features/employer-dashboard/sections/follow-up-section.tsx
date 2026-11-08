"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import type { SectionState } from "@/features/company-metrics/use-section";
import { cn } from "@/lib/utils";
import type { Drill } from "../drilldown";
import type { AttentionSection, PipelineSection } from "../model";
import { CardSlot, DashboardSection, HelpList } from "../section";
import { AttentionCard } from "./attention-card";
import { PipelineCard } from "./pipeline-card";

function help(threshold: number | undefined): [string, string][] {
  const days = threshold === undefined ? "el umbral de días hábiles" : `${threshold} días hábiles`;
  return [
    ["Entregas vencidas", "Entregas de candidatos de vacantes abiertas (también pausadas) cuya fecha meta ya pasó sin completar los candidatos prometidos. «Venció hace N días» cuenta días hábiles desde la fecha meta; primero la más atrasada."],
    ["Vencen esta semana", "Entregas aún incompletas con fecha meta de hoy al domingo de esta semana, hora del centro de México; primero la más próxima."],
    ["Candidatos detenidos", `Personas con ${days} o más en la misma etapa. Placement no cuenta. «N días sin avanzar» son días hábiles.`],
    ["Pipeline por etapa", "Foto de hoy, no depende del periodo: candidatos activos de tus vacantes abiertas por el tipo de su etapa actual. Las columnas propias de cada vacante se suman juntas."],
  ];
}

/** «Seguimiento» (artboard 09): «Necesita atención» on 8 columns beside «Pipeline por etapa» on 4; each card loads on its own. */
export function FollowUpSection({ attention, pipeline, drill, today }: {
  attention: SectionState<AttentionSection>; pipeline: SectionState<PipelineSection>; drill: Drill; today: string;
}) {
  const threshold = pipeline.data?.stalled_threshold_business_days ?? attention.data?.stalled.threshold_business_days;
  return <DashboardSection title="Seguimiento" help={{ title: "Cómo se calcula el seguimiento", body: <HelpList items={help(threshold)} /> }} loads={[attention, pipeline]}>
    <div className="grid gap-6 lg:grid-cols-12">
      <CardSlot state={attention} subject="necesita atención" className="lg:col-span-8" skeleton={<ListSkeleton tabs rows={5} />}>
        {data => <AttentionCard data={data} drill={drill} today={today} />}
      </CardSlot>
      <CardSlot state={pipeline} subject="el pipeline por etapa" className="lg:col-span-4" skeleton={<ListSkeleton rows={6} />}>
        {data => <PipelineCard data={data} drill={drill} />}
      </CardSlot>
    </div>
  </DashboardSection>;
}

/** Rule 15: a list card's shape (title, optional tabs, rows). */
export function ListSkeleton({ rows, tabs, className }: { rows: number; tabs?: boolean; className?: string }) {
  return <div aria-hidden="true" className={cn(CARD, "flex-1", className)}>
    <div className="flex flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-28" /></div>
    {tabs && <Skeleton className="h-10 w-96 max-w-full rounded-xl" />}
    <div className="flex flex-col gap-4">{Array.from({ length: rows }, (_, row) => <Skeleton key={row} className="h-11 w-full" />)}</div>
  </div>;
}
