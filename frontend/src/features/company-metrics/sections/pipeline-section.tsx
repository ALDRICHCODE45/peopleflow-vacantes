"use client";
import type { ReactNode } from "react";
import { Briefcase, Users } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { drilldownHref, type Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { formatMedian, number, personName, plural, requesterLabel, STAGE_KIND_LABEL, type PipelineSection as PipelineSectionData } from "../model";
import { CHART_ACCENT } from "../palette";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

type Href = (target: Drilldown, count: number) => string | null;
type Stage = PipelineSectionData["stages"][number];
type TopVacancy = PipelineSectionData["top_vacancies"][number];

/** «Ver el 1 candidato» / «Ver los 48 candidatos»: the accessible name of a drillable figure (rule 16). */
const see = (count: number, singular: string, pluralForm: string, tail = "") => `Ver ${count === 1 ? `el 1 ${singular}` : `los ${number.format(count)} ${pluralForm}`}${tail}`;
/** The stage kinds of a top vacancy's «en proceso» (§4.4 with DD2): active, neither new nor placement, as in the figure. */
const IN_PROCESS_KINDS = "screening,screening_ok,in_process,custom,retired";
const STAGE_BAR = "color-mix(in oklab, var(--primary) 28%, var(--pf-tint-base))";
// The stage column fits the longest label («Columnas retiradas», «Columnas propias») at 14/500 without truncating.
const STAGE_GRID = "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 sm:grid-cols-[minmax(0,152px)_minmax(0,1fr)_72px_128px_112px]";

/** Rule 7: «foto de hoy» and the stalled threshold are explanations, so they live in the popover. */
function help(threshold: number | undefined) {
  const items: [string, string][] = [
    ["Foto de hoy", "Foto de hoy; no depende del periodo. Cuenta a los candidatos activos de las vacantes abiertas (publicadas, sin cerrar), por el tipo de su etapa actual. Las columnas propias de cada vacante se suman juntas; los descartados no cuentan."],
    ["Mediana en etapa", "Mediana de días hábiles desde que la persona entró a su etapa actual."],
    ["Detenidos", threshold === undefined ? "Personas que llevan el umbral de días hábiles o más en la misma etapa. Placement no cuenta."
      : `Detenido = ${plural(threshold, "día hábil", "días hábiles")} o más en la etapa. Placement no cuenta.`],
    ["Vacantes con más candidatos", "Las vacantes abiertas con más candidatos en proceso: activos fuera de Nuevos y Placement."],
  ];
  return <dl className="flex flex-col gap-3">
    {items.map(([term, text]) => <div key={term} className="flex flex-col gap-1"><dt className="font-medium text-foreground">{term}</dt><dd>{text}</dd></div>)}
  </dl>;
}

/** Card frame of artboard 07: one job per card, `p-6`, title 15/600 with at most one muted scope line. */
function PipelineCard({ title, caption, className, children }: { title: string; caption?: ReactNode; className: string; children: ReactNode }) {
  return <Card className={cn("gap-4 p-6", className)}>
    <div className="flex flex-col gap-1">
      <h3 className="text-[15px] leading-[22px] font-semibold">{title}</h3>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
    {children}
  </Card>;
}

/** «Pipeline por etapa» (artboard 07): candidates by stage kind today and the open vacancies with most candidates. */
export function PipelineSection({ state, filters, period }: SectionProps<PipelineSectionData>) {
  const href: Href = (target, count) => drilldownHref(target, { ...filters, ...period }, { count });
  return <MetricsSection title="Pipeline por etapa" state={state}
    help={{ title: "Cómo se calcula el pipeline", body: help(state.data?.stalled_threshold_business_days) }}
    skeleton={<PipelineSkeleton />}>
    {data => <div className="grid gap-6 xl:grid-cols-12">
      <Stages stages={data.stages} href={href} />
      <TopVacancies vacancies={data.top_vacancies} href={href} />
    </div>}
  </MetricsSection>;
}

function Stages({ stages, href }: { stages: Stage[]; href: Href }) {
  const total = stages.reduce((sum, stage) => sum + stage.candidates, 0);
  const max = Math.max(0, ...stages.map(stage => stage.candidates));
  // Rule 8: one accent bar, the stage holding the most stalled people.
  const hot = stages.reduce<Stage | null>((top, stage) => stage.stalled > (top?.stalled ?? 0) ? stage : top, null);
  return <PipelineCard title="Candidatos por etapa" className="xl:col-span-8"
    caption={total > 0 && <>Hoy · <Figure href={href({ kind: "candidates", params: {} }, total)} label={see(total, "candidato en vacantes abiertas", "candidatos en vacantes abiertas")}>{number.format(total)}</Figure> {total === 1 ? "candidato" : "candidatos"} en vacantes abiertas</>}>
    {total === 0 ? <SectionEmpty icon={Users} tone="empty" title="Sin candidatos en proceso" description="Aquí verás cuántas personas hay en cada etapa de las vacantes abiertas." />
      : <div>
        <div aria-hidden="true" className={cn(STAGE_GRID, "pb-2 text-xs font-medium text-muted-foreground")}>
          <span>Etapa</span><span className="hidden sm:block" /><span className="text-right">Candidatos</span><span className="hidden text-right sm:block">Mediana en etapa</span><span className="text-right">Detenidos</span>
        </div>
        <ul className="flex flex-col divide-y">
          {stages.map(stage => <StageRow key={stage.kind} stage={stage} max={max} hot={stage === hot} href={href} />)}
        </ul>
      </div>}
  </PipelineCard>;
}

function StageRow({ stage, max, hot, href }: { stage: Stage; max: number; hot: boolean; href: Href }) {
  const label = STAGE_KIND_LABEL[stage.kind];
  const stalledHref = href({ kind: "candidates", params: { stage_kind: stage.kind, stalled: "true" } }, stage.stalled);
  const badge = "inline-flex h-[22px] items-center rounded-md border px-2 text-xs font-medium whitespace-nowrap";
  return <li className={cn(STAGE_GRID, "min-h-14 py-2")}>
    <span className="truncate font-medium">{label}</span>
    <span aria-hidden="true" className="hidden h-3 overflow-hidden rounded-full bg-muted sm:block">
      <span className="block h-full rounded-full" style={{ width: `${max > 0 ? (stage.candidates / max) * 100 : 0}%`, background: hot ? CHART_ACCENT : STAGE_BAR }} />
    </span>
    <Figure href={href({ kind: "candidates", params: { stage_kind: stage.kind } }, stage.candidates)} label={see(stage.candidates, "candidato", "candidatos", ` en ${label}`)}
      className="text-right text-xl font-semibold tabular-nums">{number.format(stage.candidates)}</Figure>
    <span className="hidden text-right text-sm text-muted-foreground tabular-nums sm:block">{formatMedian(stage.median_business_days_in_stage)}</span>
    <span className="justify-self-end">
      {/* Stalled never counts in placement (§4.4). */}
      {stage.kind === "placement" ? <span className="text-xs text-muted-foreground">No aplica</span>
        : stage.stalled > 0
          ? <Figure href={stalledHref} label={see(stage.stalled, "candidato detenido", "candidatos detenidos", ` en ${label}`)}
            className={cn(badge, "border-destructive/30 bg-destructive/10 text-destructive")}>{plural(stage.stalled, "detenido", "detenidos")}</Figure>
          : <span className={cn(badge, "bg-muted text-muted-foreground")}>Al día</span>}
    </span>
  </li>;
}

function TopVacancies({ vacancies, href }: { vacancies: TopVacancy[]; href: Href }) {
  return <PipelineCard title="Vacantes con más candidatos" className="xl:col-span-4" caption={vacancies.length > 0 && plural(vacancies.length, "vacante abierta", "vacantes abiertas")}>
    {vacancies.length === 0 ? <SectionEmpty icon={Briefcase} tone="empty" title="Sin vacantes con candidatos en proceso" description="Aquí verás las vacantes abiertas con más candidatos activos." />
      : <ul className="flex flex-col divide-y">
        {vacancies.map(row => {
          const title = row.vacancy.title?.trim() || "Vacante sin título";
          const meta = [requesterLabel(row.requester), row.responsible ? personName(row.responsible) : "Sin responsable"].join(" · ");
          return <li key={row.vacancy.draft_id} className="flex min-h-14 items-center justify-between gap-4 py-2">
            <div className="flex min-w-0 flex-col">
              <span className={cn("truncate font-medium", !row.vacancy.title?.trim() && "text-muted-foreground")}>{title}</span>
              <span className="truncate text-xs text-muted-foreground">{meta}</span>
            </div>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              <Figure href={href({ kind: "candidates", params: { vacancy_id: row.vacancy.draft_id, stage_kind: IN_PROCESS_KINDS } }, row.in_process)}
                label={see(row.in_process, "candidato", "candidatos", ` en proceso de ${title}`)} className="font-semibold">{number.format(row.in_process)}</Figure>
              <span className="text-muted-foreground"> en proceso</span>
            </span>
          </li>;
        })}
      </ul>}
  </PipelineCard>;
}

/** Rule 15: the skeleton mirrors the two cards. */
function PipelineSkeleton() {
  return <div aria-hidden="true" className="grid gap-6 xl:grid-cols-12">
    <Card className="gap-4 p-6 xl:col-span-8">
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-56" /></div>
      <div className="flex flex-col gap-4">{[0, 1, 2, 3, 4, 5].map(row => <Skeleton key={row} className="h-10 w-full" />)}</div>
    </Card>
    <Card className="gap-4 p-6 xl:col-span-4">
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-28" /></div>
      <div className="flex flex-col gap-4">{[0, 1, 2, 3, 4].map(row => <Skeleton key={row} className="h-10 w-full" />)}</div>
    </Card>
  </div>;
}
