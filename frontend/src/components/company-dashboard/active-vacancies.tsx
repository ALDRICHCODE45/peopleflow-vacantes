import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  EMPLOYER_VACANCY_STATE_LABELS,
  EMPLOYER_WORK_MODE_LABELS,
  EMPLOYER_EMPLOYMENT_TYPE_LABELS,
  vacancyCandidateTotal,
  vacancyPipelineHref,
} from "@/features/employer-vacancies/model";
import type { EmployerVacancy } from "@/features/employer-vacancies/model";

/**
 * Pure server-rendered active-vacancies panel for the employer dashboard.
 *
 * The panel renders only `state === "active"` vacancies in input order, paired
 * with a portfolio link to `/empresa/vacantes` and exactly one semantic
 * pipeline link per non-interactive row. No client directive, state, effect,
 * fetch, storage or business mutation: the validated prototype fixture arrives
 * as props and the canonical pipeline href comes from the model helper.
 */

/** Stable hook for the heading id; deterministic so tests can rely on it. */
const HEADING_ID = "dashboard-active-vacancies-heading";

/** Two-letter monogram of a vacancy title; purely decorative. */
const monogram = (title: string) =>
  title
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

/** Natural Spanish agreement: singular for exactly one, plural otherwise. */
const historyCopy = (total: number) =>
  `${total} candidato${total === 1 ? "" : "s"} en el historial`;

export function ActiveVacancies({ vacancies }: { vacancies: readonly EmployerVacancy[] }) {
  const active = vacancies.filter((vacancy) => vacancy.state === "active");

  return (
    <section
      aria-labelledby={HEADING_ID}
      data-pf-active-vacancies=""
      className="flex flex-col gap-4"
    >
      <Card>
      <CardHeader>
        <CardTitle><h2
          id={HEADING_ID}
          className="font-heading text-[15px] font-semibold tracking-tight text-foreground"
        >
          Vacantes activas
        </h2></CardTitle>
        {active.length > 0 && <CardAction><Link
          href="/empresa/vacantes"
          data-pf-active-vacancies-portfolio=""
          className={buttonVariants({ variant: "outline", className: "min-h-10" })}
        >
          Ver todas
        </Link></CardAction>}
      </CardHeader>
      <CardContent>
      {active.length === 0 ? (
        <Empty data-pf-active-vacancies-empty="">
          <EmptyHeader className="max-w-md">
            <EmptyTitle className="text-xl font-semibold">No hay vacantes activas</EmptyTitle>
            <EmptyDescription className="max-w-md">Aquí verás los procesos de tus vacantes activas. Mientras tanto, revisa tus vacantes y prepara la siguiente publicación.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-col sm:flex-row sm:justify-center">
            <Link href="/empresa/vacantes" data-pf-active-vacancies-portfolio="" className={buttonVariants({ className: "min-h-10 w-full sm:w-auto" })}>Ver todas</Link>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {active.map((vacancy) => {
            const total = vacancyCandidateTotal(vacancy.candidateCounts);
            return (
              <Item render={<li />}
                key={vacancy.id}
                data-pf-active-vacancy-row={vacancy.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                  <ItemMedia><span
                    aria-hidden="true"
                    data-pf-active-vacancy-monogram=""
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-[13px] font-bold text-foreground"
                  >
                    {monogram(vacancy.title)}
                  </span></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="break-words">
                      {vacancy.title}
                    </ItemTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge data-pf-active-vacancy-status="" variant="accent" dot>{EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]}</Badge>
                      <p className="text-sm text-muted-foreground">{EMPLOYER_WORK_MODE_LABELS[vacancy.workMode]} · {EMPLOYER_EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]}</p>
                    </div>
                    <ItemDescription>{historyCopy(total)}</ItemDescription>
                  </ItemContent>
                <ItemActions className="w-full sm:w-auto">
                  <Link
                    href={vacancyPipelineHref(vacancy.id)}
                    data-pf-active-vacancy-pipeline={vacancy.id}
                    aria-label={`Ver pipeline de ${vacancy.title}`}
                    className={buttonVariants({ variant: "outline", className: "min-h-10 w-full sm:w-auto" })}
                  >
                    Ver pipeline
                  </Link>
                </ItemActions>
              </Item>
            );
          })}
        </ul>
      )}
      </CardContent>
      </Card>
    </section>
  );
}
