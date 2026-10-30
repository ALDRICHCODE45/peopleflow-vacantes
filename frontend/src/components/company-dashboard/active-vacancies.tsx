import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionEmpty } from "@/components/feedback/state-card";
import { BriefcaseBusiness } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  EMPLOYER_VACANCY_STATE_LABELS,
  EMPLOYER_WORK_MODE_LABELS,
  EMPLOYER_EMPLOYMENT_TYPE_LABELS,
  vacancyPipelineHref,
} from "@/features/employer-vacancies/model";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { cn } from "@/lib/utils";

/**
 * Pure server-rendered active-vacancies panel for the employer dashboard.
 *
 * Published draft-list rows in input order, with the canonical pipeline link.
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
  `${total} candidato${total === 1 ? "" : "s"} en proceso`;

export function ActiveVacancies({ vacancies }: { vacancies: readonly DraftListRow[] }) {
  const active = vacancies.filter((vacancy) => vacancy.status === "published");

  return (
    <section
      aria-labelledby={HEADING_ID}
      data-pf-active-vacancies=""
      className="flex flex-col gap-4"
    >
      <Card {...(active.length === 0 ? { "data-pf-active-vacancies-empty": "" } : {})}>
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
          className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}
        >
          Ver todas
        </Link></CardAction>}
      </CardHeader>
      <CardContent>
      {active.length === 0 ? (
        <SectionEmpty icon={BriefcaseBusiness} tone="empty" title="Todavía no hay vacantes activas"
          description="Aquí verás tus procesos cuando publiques una vacante. Revisa tus vacantes para preparar la siguiente publicación."
          primaryAction={{ label: "Ver mis vacantes", href: "/empresa/vacantes" }} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {active.map((vacancy) => {
            const total = vacancy.candidates?.in_process ?? 0;
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
                    {monogram(vacancy.title ?? "Sin título")}
                  </span></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="break-words">
                      {vacancy.title ?? "Sin título"}
                    </ItemTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge data-pf-active-vacancy-status="" variant="accent" dot>{EMPLOYER_VACANCY_STATE_LABELS.active}</Badge>
                      <p className="text-sm text-muted-foreground">{[vacancy.work_mode && EMPLOYER_WORK_MODE_LABELS[vacancy.work_mode], vacancy.work_schedule && EMPLOYER_EMPLOYMENT_TYPE_LABELS[vacancy.work_schedule]].filter(Boolean).join(" · ")}</p>
                    </div>
                    <ItemDescription>{historyCopy(total)}</ItemDescription>
                  </ItemContent>
                <ItemActions className="w-full sm:w-auto">
                  <Link
                    href={vacancyPipelineHref(vacancy.id)}
                    data-pf-active-vacancy-pipeline={vacancy.id}
                    aria-label={`Ver pipeline de ${vacancy.title}`}
                    className={cn(buttonVariants({ variant: "outline", className: "min-h-10 w-full sm:w-auto" }))}
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
