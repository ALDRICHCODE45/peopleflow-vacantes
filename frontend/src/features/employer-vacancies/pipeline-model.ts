import { z } from "zod";

import { VACANCY_PIPELINE_STAGES } from "./model";
import type { VacancyPipelineStage } from "./model";

/**
 * Pure, server-safe pipeline candidate model for
 * `/empresa/vacantes/[jobId]/pipeline`. It validates with the existing zod
 * dependency and imports only the frozen employer model: no transport, React,
 * browser API, or public job schema can reach it, and nothing is persisted.
 */

/**
 * Where a prototype candidate came from. Declared locally because the public
 * job wire schema owns no candidate source vocabulary.
 */
export const CANDIDATE_SOURCES = ["direct", "referral", "linkedin", "job_board", "other"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/**
 * Candidate status reuses the committed application vocabulary exported by the
 * employer vacancy model, so this model never invents Screening/Entrevista
 * stages.
 */
export type CandidateStatus = VacancyPipelineStage;

/** Spanish display labels for candidate status; mirrors the employer pipeline. */
export const CANDIDATE_STATUS_LABELS: Readonly<Record<CandidateStatus, string>> = Object.freeze({
  submitted: "Nuevos",
  in_review: "En revisión",
  hired: "Contratados",
  rejected: "Descartados",
});

/** Spanish display labels for candidate sources. */
export const CANDIDATE_SOURCE_LABELS: Readonly<Record<CandidateSource, string>> = Object.freeze({
  direct: "Directo",
  referral: "Referido",
  linkedin: "LinkedIn",
  job_board: "Portal de empleo",
  other: "Otro",
});

/** One display-ready prototype candidate of a single vacancy pipeline. */
export type PipelineCandidate = {
  readonly id: string;
  readonly vacancyId: string;
  readonly fullName: string;
  readonly professionalTitle: string;
  readonly yearsOfExperience: number;
  readonly status: CandidateStatus;
  readonly source: CandidateSource;
  /** Offset-aware ISO timestamp the application was received at. */
  readonly receivedAt: string;
  /** Offset-aware ISO timestamp of the latest recorded activity. */
  readonly lastActivityAt: string;
  /** Recruiter responsible for the candidate. */
  readonly owner: string;
  readonly skills: readonly string[];
  readonly matchScore: number;
  readonly commentCount: number;
  /** Optional short next-step context shown to the recruiter. */
  readonly nextStep?: string;
};

/** URL-safe slug shape stable candidate and vacancy ids rely on. */
const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64);
const offsetAwareIsoDateTime = z.string().datetime({ offset: true });
/** Practical display bound shared by candidate name, title, and responsible owner. */
const personTextSchema = z.string().trim().min(1).max(120);

/**
 * Validates one prototype candidate. Strict on purpose: an unknown status or
 * source, fractional or out-of-range score, unqualified timestamp, empty or
 * oversized tag list, malformed id, or extra key is a fixture bug that must
 * fail at the module boundary, not at render.
 */
export const pipelineCandidateSchema = z
  .object({
    id: slugSchema,
    vacancyId: slugSchema,
    fullName: personTextSchema,
    professionalTitle: personTextSchema,
    yearsOfExperience: z.number().int().nonnegative().max(60),
    status: z.enum(VACANCY_PIPELINE_STAGES),
    source: z.enum(CANDIDATE_SOURCES),
    receivedAt: offsetAwareIsoDateTime,
    lastActivityAt: offsetAwareIsoDateTime,
    owner: personTextSchema,
    skills: z.array(z.string().trim().min(1).max(40)).min(1).max(4),
    matchScore: z.number().int().min(0).max(100),
    commentCount: z.number().int().nonnegative().max(10000),
    nextStep: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/** Validates the whole prototype candidate set in one boundary call. */
export const pipelineCandidatesSchema = z.array(pipelineCandidateSchema).max(500);

/** Parses untrusted fixture data into validated prototype candidates. */
export function parsePipelineCandidates(input: unknown): readonly PipelineCandidate[] {
  return pipelineCandidatesSchema.parse(input);
}

/** Exact vacancy match; source order is preserved so the board stays deterministic. */
export function filterCandidatesByVacancy(
  candidates: readonly PipelineCandidate[],
  vacancyId: string,
): readonly PipelineCandidate[] {
  return candidates.filter((candidate) => candidate.vacancyId === vacancyId);
}

/** Exact candidate id lookup; an absent or unknown id stays unknown. */
export function findCandidateById(
  candidates: readonly PipelineCandidate[],
  id: string,
): PipelineCandidate | undefined {
  return candidates.find((candidate) => candidate.id === id);
}

/** Exact counts per application stage; every stage is always present, even at zero. */
export function summarizeCandidateStages(
  candidates: readonly PipelineCandidate[],
): Readonly<Record<VacancyPipelineStage, number>> {
  const summary: Record<VacancyPipelineStage, number> = { submitted: 0, in_review: 0, hired: 0, rejected: 0 };
  for (const candidate of candidates) summary[candidate.status] += 1;
  return summary;
}

/**
 * Explicit honest copy for the pipeline surface: committed fixtures are
 * representative local demo cards and may be a subset of the portfolio counts,
 * so this helper never claims the visible cards equal the vacancy summary.
 */
export function visibleCandidatesCopy(visibleCount: number, vacancyTotal: number): string {
  return `Mostrando ${visibleCount} de ${vacancyTotal} candidatos de esta vacante en esta vista de demostración.`;
}
