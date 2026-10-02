import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  EMPLOYER_VACANCY_STATE_LABELS,
  findEmployerVacancy,
  vacancyCandidateTotal,
} from "@/features/employer-vacancies/model";
import type { EmployerVacancyState } from "@/features/employer-vacancies/model";
import { filterCandidatesByVacancy } from "@/features/employer-vacancies/pipeline-model";
import { PipelineWorkspace } from "@/features/employer-vacancies/pipeline-workspace";
import { NEXO_CANDIDATES } from "@/features/employer-vacancies/prototype-candidates";
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies";

/**
 * Employer vacancy pipeline route content for
 * `/empresa/vacantes/[jobId]/pipeline`.
 *
 * The shared `(empresa)` layout already owns the single EmployerShell, the
 * sidebar provider and the theme module, so this route contributes only its
 * header, intro and the mounted pipeline workspace. The vacancy and
 * its candidate cards are resolved from the frozen local Nexo fixtures by exact
 * id: an unknown, near-miss or malformed id renders the framework not-found
 * document and never a fallback vacancy. It stays a server component and owns no
 * request, credential store or persistence concern.
 */
type PipelineRouteProps = {
  params: Promise<{ jobId: string }>;
};

/** Publication-state variant: the Spanish text label always carries the meaning
    and the shared Badge variant only supplements it. */
const STATUS_VARIANT: Readonly<Record<EmployerVacancyState, BadgeVariant>> = {
  active: "accent",
  paused: "review",
  closed: "neutral",
};

/** Spanish singular/plural agreement for the pipeline counters. */
const countCopy = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

export async function generateMetadata({ params }: PipelineRouteProps): Promise<Metadata> {
  const { jobId } = await params;
  const vacancy = findEmployerVacancy(NEXO_VACANCIES, jobId);

  // Unknown vacancies render the framework not-found document, which Next marks
  // as non-indexable on its own; this route makes no indexing claim.
  if (vacancy === undefined) {
    return {};
  }

  return { title: `${vacancy.title} · Pipeline` };
}

export default async function PipelinePage({ params }: PipelineRouteProps) {
  const { jobId } = await params;
  const vacancy = findEmployerVacancy(NEXO_VACANCIES, jobId);

  if (vacancy === undefined) {
    notFound();
  }

  const candidates = filterCandidatesByVacancy(NEXO_CANDIDATES, vacancy.id);
  const candidateTotal = vacancyCandidateTotal(vacancy.candidateCounts);

  return (
    <>
      <SiteHeader
        title={vacancy.title}
        parent={{ label: "Vacantes", href: "/empresa/vacantes" }}
        status={
          <Badge
            data-pf-vacancy-status={vacancy.state}
            variant={STATUS_VARIANT[vacancy.state]}
            dot
          >
            {EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]}
          </Badge>
        }
      />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent
          data-pf-pipeline-content=""
          width="screen-2xl"
          className="gap-5 md:gap-6"
        >
          <section
            data-pf-pipeline-intro=""
            aria-labelledby="pipeline-heading"
            className="flex flex-col gap-1.5"
          >
            <h2
              id="pipeline-heading"
              className="font-heading text-[19px] font-semibold text-foreground"
            >
              Pipeline
            </h2>
            <p className="max-w-prose text-[13.5px] text-muted-foreground">
              {countCopy(candidateTotal, "candidato", "candidatos")} en el historial ·{" "}
              {vacancy.teamSize} miembros del equipo
            </p>
          </section>
          <PipelineWorkspace vacancy={vacancy} candidates={candidates} />
        </DashboardPageContent>
      </div>
    </>
  );
}
