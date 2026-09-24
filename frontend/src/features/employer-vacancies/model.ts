import { z } from "zod";

/**
 * Prototype employer-vacancy model for `/empresa/vacantes` and
 * `/empresa/vacantes/[jobId]/pipeline`. It owns a closed local publication-state
 * vocabulary and imports only zod: no public job wire schema, transport, React,
 * browser API, or client table component can reach it, and nothing is persisted.
 */

/**
 * Local publication states of an employer vacancy. The public job wire schema
 * carries no publication state, so this vocabulary is declared here instead of
 * being read from it; the committed designs show exactly three states.
 */
export const EMPLOYER_VACANCY_STATES = ["active", "paused", "closed"] as const;
export type EmployerVacancyState = (typeof EMPLOYER_VACANCY_STATES)[number];

/** Work arrangement of a prototype vacancy, declared locally to this feature. */
export const EMPLOYER_WORK_MODES = ["onsite", "remote", "hybrid"] as const;
export type EmployerWorkMode = (typeof EMPLOYER_WORK_MODES)[number];

/** Employment type of a prototype vacancy, declared locally to this feature. */
export const EMPLOYER_EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export type EmployerEmploymentType = (typeof EMPLOYER_EMPLOYMENT_TYPES)[number];

/**
 * Candidate pipeline stages. They mirror the existing application vocabulary
 * (`submitted`, `in_review`, `hired`, `rejected`) as plain local tokens, without
 * importing the client table component that renders them.
 */
export const VACANCY_PIPELINE_STAGES = ["submitted", "in_review", "hired", "rejected"] as const;
export type VacancyPipelineStage = (typeof VACANCY_PIPELINE_STAGES)[number];

/** Spanish display labels for the local publication states. */
export const EMPLOYER_VACANCY_STATE_LABELS: Readonly<Record<EmployerVacancyState, string>> = Object.freeze({
  active: "Activa",
  paused: "Pausada",
  closed: "Cerrada",
});

/** Spanish display labels for the work arrangements. */
export const EMPLOYER_WORK_MODE_LABELS: Readonly<Record<EmployerWorkMode, string>> = Object.freeze({
  onsite: "Presencial",
  remote: "Remoto",
  hybrid: "Híbrido",
});

/** Spanish display labels for the employment types. */
export const EMPLOYER_EMPLOYMENT_TYPE_LABELS: Readonly<Record<EmployerEmploymentType, string>> = Object.freeze({
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
  contract: "Contrato",
  internship: "Pasantía",
});

/** Candidates per pipeline stage; all four stages are always present. */
export type VacancyCandidateCounts = Readonly<Record<VacancyPipelineStage, number>>;

/** One display-ready prototype vacancy of the fictional employer. */
export type EmployerVacancy = {
  readonly id: string;
  readonly title: string;
  readonly workMode: EmployerWorkMode;
  readonly employmentType: EmployerEmploymentType;
  readonly state: EmployerVacancyState;
  /** Offset-aware ISO timestamp the vacancy was published at. */
  readonly publishedAt: string;
  /** Recruiter responsible for the position. */
  readonly recruiter: string;
  /** Members of the team working on the position. */
  readonly teamSize: number;
  readonly candidateCounts: VacancyCandidateCounts;
};

/** URL-safe slug shape a stable vacancy id and its pipeline route rely on. */
const vacancyIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const stageCountSchema = z.number().int().nonnegative();
const offsetAwareIsoDateTime = z.string().datetime({ offset: true });

/**
 * Validates one prototype vacancy. Strict on purpose: an unknown state, stage,
 * negative or fractional count, unqualified timestamp, malformed id, or extra
 * key is a fixture bug that must fail at the module boundary, not at render.
 */
export const employerVacancySchema = z
  .object({
    id: vacancyIdSchema,
    title: z.string().min(1),
    workMode: z.enum(EMPLOYER_WORK_MODES),
    employmentType: z.enum(EMPLOYER_EMPLOYMENT_TYPES),
    state: z.enum(EMPLOYER_VACANCY_STATES),
    publishedAt: offsetAwareIsoDateTime,
    recruiter: z.string().min(1),
    teamSize: z.number().int().nonnegative(),
    candidateCounts: z
      .object({
        submitted: stageCountSchema,
        in_review: stageCountSchema,
        hired: stageCountSchema,
        rejected: stageCountSchema,
      })
      .strict(),
  })
  .strict();

/** Validates the whole prototype portfolio in one boundary call. */
export const employerVacanciesSchema = z.array(employerVacancySchema);

/** Parses untrusted fixture data into validated prototype vacancies. */
export function parseEmployerVacancies(input: unknown): readonly EmployerVacancy[] {
  return employerVacanciesSchema.parse(input);
}

/** Canonical pipeline route of one vacancy; ids are URL-safe by validation. */
export function vacancyPipelineHref(jobId: string): string {
  return `/empresa/vacantes/${jobId}/pipeline`;
}

/** Resolves one vacancy by exact id; an absent or unknown id stays unknown. */
export function findEmployerVacancy(vacancies: readonly EmployerVacancy[], jobId: string): EmployerVacancy | undefined {
  return vacancies.find((vacancy) => vacancy.id === jobId);
}

/** Candidates still actionable on a vacancy: submitted plus in review. */
export function vacancyInProcessCount(candidateCounts: VacancyCandidateCounts): number {
  return candidateCounts.submitted + candidateCounts.in_review;
}

/** Every candidate ever attached to a vacancy, across all four stages. */
export function vacancyCandidateTotal(candidateCounts: VacancyCandidateCounts): number {
  return VACANCY_PIPELINE_STAGES.reduce((total, stage) => total + candidateCounts[stage], 0);
}

/** Exact portfolio counters the vacancy list renders. */
export type EmployerVacancySummary = {
  readonly total: number;
  readonly active: number;
  readonly paused: number;
  readonly closed: number;
  readonly totalCandidates: number;
  readonly inProcessCandidates: number;
};

/** Derives the portfolio summary from a vacancy list without mutating it. */
export function summarizeEmployerVacancies(vacancies: readonly EmployerVacancy[]): EmployerVacancySummary {
  const countWithState = (state: EmployerVacancyState): number => vacancies.filter((vacancy) => vacancy.state === state).length;
  return {
    total: vacancies.length,
    active: countWithState("active"),
    paused: countWithState("paused"),
    closed: countWithState("closed"),
    totalCandidates: vacancies.reduce((total, vacancy) => total + vacancyCandidateTotal(vacancy.candidateCounts), 0),
    inProcessCandidates: vacancies.reduce((total, vacancy) => total + vacancyInProcessCount(vacancy.candidateCounts), 0),
  };
}
