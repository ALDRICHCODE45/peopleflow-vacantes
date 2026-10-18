import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  EMPLOYER_VACANCY_STATE_LABELS,
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
        <CardAction><Link
          href="/empresa/vacantes"
          data-pf-active-vacancies-portfolio=""
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          Ver todas
        </Link></CardAction>
      </CardHeader>
      <CardContent>
      {active.length === 0 ? (
        <Empty data-pf-active-vacancies-empty=""><EmptyHeader><EmptyDescription>No hay vacantes activas</EmptyDescription></EmptyHeader></Empty>
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
                    <ItemTitle className="truncate">
                      {vacancy.title}
                    </ItemTitle>
                    <ItemDescription>{historyCopy(total)}</ItemDescription>
                  </ItemContent>
                <ItemActions className="flex-wrap">
                  <Badge
                    data-pf-active-vacancy-status=""
                    variant="accent"
                    dot
                  >
                    {EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]}
                  </Badge>
                  <Link
                    href={vacancyPipelineHref(vacancy.id)}
                    data-pf-active-vacancy-pipeline={vacancy.id}
                    aria-label={`Ver pipeline de ${vacancy.title}`}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium text-foreground transition-colors duration-200 hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
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
