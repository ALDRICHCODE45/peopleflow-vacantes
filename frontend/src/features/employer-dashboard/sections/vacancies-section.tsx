"use client";
import { useId } from "react";
import Link from "next/link";
import { BriefcaseBusiness, ChevronRight, Users } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Figure } from "@/features/company-metrics/figure";
import { number, personName, requesterLabel } from "@/features/company-metrics/model";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import type { SectionState } from "@/features/company-metrics/use-section";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { cn } from "@/lib/utils";
import type { Drill } from "../drilldown";
import { initials, relativeMoment, stageTone } from "../format";
import type { RecentSection, VacanciesSection as VacanciesData } from "../model";
import { CardHead, CardSlot, DashboardSection, FootLink, HelpList } from "../section";
import { ListSkeleton } from "./follow-up-section";

const HELP: [string, string][] = [
  ["Vacantes activas", "Las 5 vacantes publicadas con más candidatos en proceso (activos fuera de Nuevos y Placement); la barra compara con la que tiene más."],
  ["Posiciones", "Contrataciones vigentes frente a las posiciones requeridas por la vacante."],
  ["Candidatos recientes", "Las 5 personas que se postularon o que tu equipo registró más recientemente en tus vacantes, con su etapa actual."],
];
/** Rule 14: below `sm` a row is the title, the in-process figure and a chevron; positions wait for the wide grid. */
const VAC_GRID = "grid grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_160px_76px] sm:gap-4";
const title = (value: string) => value.trim() || "Vacante sin título";

/** «Vacantes y candidatos» (artboard 09): the active vacancies beside the recent candidates, 6 + 6, each loading on its own. */
export function VacanciesSection({ vacancies, recent, drill, now }: { vacancies: SectionState<VacanciesData>; recent: SectionState<RecentSection>; drill: Drill; now: Date }) {
  return <DashboardSection title="Vacantes y candidatos" help={{ title: "Cómo se calculan vacantes y candidatos", body: <HelpList items={HELP} /> }} loads={[vacancies, recent]}>
    <div className="grid gap-6 lg:grid-cols-12">
      <CardSlot state={vacancies} subject="las vacantes activas" className="lg:col-span-6" skeleton={<ListSkeleton rows={5} />}>
        {data => <ActiveVacancies data={data} drill={drill} />}
      </CardSlot>
      <CardSlot state={recent} subject="los candidatos recientes" className="lg:col-span-6" skeleton={<ListSkeleton rows={5} />}>
        {data => <RecentCandidates rows={data.recent} now={now} />}
      </CardSlot>
    </div>
  </DashboardSection>;
}

function ActiveVacancies({ data, drill }: { data: VacanciesData; drill: Drill }) {
  const headingId = useId();
  const max = Math.max(0, ...data.top.map(row => row.in_process));
  return <article aria-labelledby={headingId} className={cn(CARD, "flex-1")}>
    <CardHead id={headingId} title="Vacantes activas" caption={data.top.length > 0 && "Publicadas, por candidatos en proceso"} />
    {data.top.length === 0
      ? <SectionEmpty icon={BriefcaseBusiness} tone="empty" title="Todavía no hay vacantes activas"
        description="Aquí verás tus procesos cuando publiques una vacante. Revisa tus vacantes para preparar la siguiente publicación."
        primaryAction={{ label: "Ver mis vacantes", href: "/empresa/vacantes" }} />
      : <div>
        <div aria-hidden="true" className={cn(VAC_GRID, "pb-2 text-xs font-medium text-muted-foreground max-sm:hidden")}>
          <span>Vacante</span><span className="text-right">En proceso</span><span className="text-right">Posiciones</span>
        </div>
        <ul className="flex flex-col divide-y">
          {data.top.map(row => {
            const name = title(row.vacancy.title);
            const meta = [requesterLabel(row.requester), row.responsible ? personName(row.responsible) : "Sin responsable"].join(" · ");
            return <li key={row.vacancy.draft_id} className={cn(VAC_GRID, "relative min-h-15 max-sm:py-3")}>
              <div className="min-w-0">
                {/* Below `sm` the title wraps instead of being cut, and its link covers the row so the chevron opens it. */}
                <Link href={vacancyPipelineHref(row.vacancy.draft_id)} aria-label={`Abrir el pipeline de ${name}`}
                  className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring max-sm:whitespace-normal max-sm:break-words max-sm:after:absolute max-sm:after:inset-0 max-sm:after:content-['']">{name}</Link>
                <span className="block truncate text-xs text-muted-foreground">{meta}</span>
              </div>
              <span className="flex items-baseline justify-end gap-1 sm:grid sm:grid-cols-[minmax(0,1fr)_28px] sm:items-center sm:gap-3">
                <span aria-hidden="true" className="hidden h-2 overflow-hidden rounded-full bg-muted sm:block">
                  <span className="block h-full rounded-full bg-[color-mix(in_oklab,var(--primary)_60%,var(--pf-tint-base))]" style={{ width: `${max > 0 ? (row.in_process / max) * 100 : 0}%` }} />
                </span>
                <Figure href={drill({ kind: "candidates", params: { vacancy_id: row.vacancy.draft_id, in_process: "true" } }, row.in_process)}
                  label={`Ver ${row.in_process === 1 ? "el 1 candidato" : `los ${number.format(row.in_process)} candidatos`} en proceso de ${name}`}
                  className="relative z-10 text-right font-semibold tabular-nums">{number.format(row.in_process)}</Figure>
                {/* Below `sm` the column header is hidden, so the one figure says what it is. */}
                <span aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">en proceso</span>
              </span>
              <span className="text-right whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
                {row.positions.required === 0 ? "Sin definir"
                  : <><b className="font-semibold text-foreground">{number.format(row.positions.covered)}</b> de {number.format(row.positions.required)}</>}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground sm:hidden" />
            </li>;
          })}
        </ul>
      </div>}
    {data.top.length > 0 && <FootLink href="/empresa/vacantes">Ver todas las vacantes</FootLink>}
  </article>;
}

function RecentCandidates({ rows, now }: { rows: RecentSection["recent"]; now: Date }) {
  const headingId = useId();
  return <article aria-labelledby={headingId} className={cn(CARD, "flex-1")}>
    <CardHead id={headingId} title="Candidatos recientes" caption={rows.length > 0 && "Últimas postulaciones y registros"} />
    {rows.length === 0
      ? <SectionEmpty icon={Users} tone="empty" title="Sin candidatos" description="Aquí puedes revisar las postulaciones y su etapa. Mientras tanto, consulta tus vacantes."
        primaryAction={{ label: "Ver vacantes", href: "/empresa/vacantes" }} />
      : <ul className="flex flex-col divide-y">
        {rows.map(row => {
          const name = row.candidate.name.trim() || "Candidato sin nombre";
          const vacancy = title(row.vacancy.title);
          return <li key={row.participation_id} className="grid min-h-15 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[32px_minmax(0,1fr)_auto_76px]">
            <Avatar className="size-8"><AvatarFallback className="bg-secondary text-xs font-medium text-foreground">{initials(name)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              {/* As the current dashboard: the name opens the vacancy board where the person is. */}
              {/* The title (application snapshot, T13) shares the name line, so the row keeps its height; null shows nothing. */}
              <div className="flex min-w-0 items-baseline gap-1.5">
                <Link href={vacancyPipelineHref(row.vacancy.id)} className="block min-w-0 shrink truncate rounded-sm font-medium outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring">{name}</Link>
                {row.candidate.professional_title?.trim() && <span data-candidate-title className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">{row.candidate.professional_title.trim()}</span>}
              </div>
              <span className="block truncate text-xs text-muted-foreground">{vacancy} · {row.added_by ? `Agregado por ${row.added_by.name}` : "Postulación"}</span>
            </div>
            <Badge className={cn("stage-badge h-[22px]", stageTone(row.stage.kind))}>{row.stage.name}</Badge>
            <time dateTime={row.applied_at} className="hidden text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:block">{relativeMoment(row.applied_at, now)}</time>
          </li>;
        })}
      </ul>}
  </article>;
}
