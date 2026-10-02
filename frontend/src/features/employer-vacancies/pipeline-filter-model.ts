import { VACANCY_PIPELINE_STAGES } from "./model";
import {
  CANDIDATE_SOURCES,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUS_LABELS,
} from "./pipeline-model";
import type { CandidateSource, CandidateStatus, PipelineCandidate } from "./pipeline-model";

/**
 * Pure, server-safe filter model for the per-vacancy pipeline surface.
 *
 * It owns the in-memory filter state, the matching predicate and every derived
 * option/chip. It imports only the frozen pipeline and vacancy vocabularies: no
 * transport, React, browser API or storage can reach it, and nothing is
 * persisted. Values OR inside one facet and AND across facets plus the text
 * search, so a candidate only survives when every active criterion holds at
 * once.
 */

/** Complete local filter state of one vacancy pipeline; every facet is optional. */
export type PipelineFilters = {
  readonly query: string;
  readonly statuses: readonly CandidateStatus[];
  readonly sources: readonly CandidateSource[];
  readonly skills: readonly string[];
  /** Inclusive lower civil-day bound (`YYYY-MM-DD`) of the reception window. */
  readonly receivedFrom: string | undefined;
  /** Inclusive upper civil-day bound (`YYYY-MM-DD`) of the reception window. */
  readonly receivedTo: string | undefined;
  readonly experienceMin: number | undefined;
  readonly experienceMax: number | undefined;
};

/** A fresh, match-nothing-but-everything filter set: no facet is active. */
export function createEmptyPipelineFilters(): PipelineFilters {
  return {
    query: "",
    statuses: [],
    sources: [],
    skills: [],
    receivedFrom: undefined,
    receivedTo: undefined,
    experienceMin: undefined,
    experienceMax: undefined,
  };
}

/**
 * Closed experience buckets used by the single-select experience facet. The
 * last bucket is lower-bound only: it carries no upper ceiling, so a senior
 * candidate is never dropped by an artificially low cap.
 */
export const PIPELINE_EXPERIENCE_BUCKETS = [
  { value: "0-2", label: "Hasta 2 años", min: 0, max: 2 },
  { value: "3-5", label: "3 a 5 años", min: 3, max: 5 },
  { value: "6-9", label: "6 a 9 años", min: 6, max: 9 },
  { value: "10+", label: "10 años o más", min: 10, max: undefined },
] as const;
export type PipelineExperienceBucketValue =
  (typeof PIPELINE_EXPERIENCE_BUCKETS)[number]["value"];

/** Diacritic- and case-insensitive search normalization, shared with the workspace. */
export function normalizePipelineSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Existing pipeline search semantics: a single normalized needle matched as a
 * substring against the candidate name, professional title or any skill.
 */
export function pipelineCandidateMatchesQuery(
  candidate: PipelineCandidate,
  query: string,
): boolean {
  const needle = normalizePipelineSearchText(query);
  if (needle === "") return true;
  return [candidate.fullName, candidate.professionalTitle, ...candidate.skills].some(
    (field) => normalizePipelineSearchText(field).includes(needle),
  );
}

/**
 * A candidate matches when the search passes AND every active facet passes.
 * OR inside a facet, AND across facets.
 */
export function pipelineCandidateMatchesFilters(
  candidate: PipelineCandidate,
  filters: PipelineFilters,
): boolean {
  if (!pipelineCandidateMatchesQuery(candidate, filters.query)) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(candidate.status)) return false;
  if (filters.sources.length > 0 && !filters.sources.includes(candidate.source)) return false;
  if (filters.skills.length > 0 && !candidate.skills.some((skill) => filters.skills.includes(skill))) {
    return false;
  }
  if (filters.experienceMin !== undefined && candidate.yearsOfExperience < filters.experienceMin) {
    return false;
  }
  if (filters.experienceMax !== undefined && candidate.yearsOfExperience > filters.experienceMax) {
    return false;
  }
  // Both comparisons read the same supplied civil day (`slice(0, 10)`), so an
  // offset-aware timestamp never shifts a day and the bounds stay inclusive.
  const receivedDay = candidate.receivedAt.slice(0, 10);
  if (filters.receivedFrom !== undefined && receivedDay < filters.receivedFrom) return false;
  if (filters.receivedTo !== undefined && receivedDay > filters.receivedTo) return false;
  return true;
}

/** The single filtered projection both views render. */
export function filterPipelineCandidates(
  candidates: readonly PipelineCandidate[],
  filters: PipelineFilters,
): readonly PipelineCandidate[] {
  return candidates.filter((candidate) => pipelineCandidateMatchesFilters(candidate, filters));
}

/** Whether any search or facet criterion is active. */
export function hasActivePipelineFilters(filters: PipelineFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.statuses.length > 0 ||
    filters.sources.length > 0 ||
    filters.skills.length > 0 ||
    filters.receivedFrom !== undefined ||
    filters.receivedTo !== undefined ||
    filters.experienceMin !== undefined ||
    filters.experienceMax !== undefined
  );
}

/** One selectable option of a searchable facet. */
export type PipelineFilterOption = {
  readonly value: string;
  readonly label: string;
};

/**
 * Status options present in the unfiltered vacancy-scoped input, in canonical
 * stage order. Options are derived from the full input, so filtering the
 * visible list never removes an option.
 */
export function pipelineStatusOptions(
  candidates: readonly PipelineCandidate[],
): readonly PipelineFilterOption[] {
  return VACANCY_PIPELINE_STAGES.filter((status) =>
    candidates.some((candidate) => candidate.status === status),
  ).map((status) => ({ value: status, label: CANDIDATE_STATUS_LABELS[status] }));
}

/** Source options present in the unfiltered vacancy-scoped input, in canonical order. */
export function pipelineSourceOptions(
  candidates: readonly PipelineCandidate[],
): readonly PipelineFilterOption[] {
  return CANDIDATE_SOURCES.filter((source) =>
    candidates.some((candidate) => candidate.source === source),
  ).map((source) => ({ value: source, label: CANDIDATE_SOURCE_LABELS[source] }));
}

/** Distinct skill options of the unfiltered vacancy-scoped input, sorted. */
export function pipelineSkillOptions(
  candidates: readonly PipelineCandidate[],
): readonly PipelineFilterOption[] {
  const skills = new Set<string>();
  for (const candidate of candidates) {
    for (const skill of candidate.skills) skills.add(skill);
  }
  return [...skills].sort().map((skill) => ({ value: skill, label: skill }));
}

/** One removable active-filter chip. */
export type PipelineFilterChip = {
  readonly key: string;
  readonly label: string;
};

/** Every active criterion as a removable chip, in a stable facet order. */
export function describePipelineFilters(
  filters: PipelineFilters,
): readonly PipelineFilterChip[] {
  const chips: PipelineFilterChip[] = [];
  if (filters.query.trim() !== "") {
    chips.push({ key: "query", label: `Búsqueda: ${filters.query.trim()}` });
  }
  for (const status of filters.statuses) {
    chips.push({ key: `status:${status}`, label: `Etapa: ${CANDIDATE_STATUS_LABELS[status]}` });
  }
  for (const source of filters.sources) {
    chips.push({ key: `source:${source}`, label: `Origen: ${CANDIDATE_SOURCE_LABELS[source]}` });
  }
  if (filters.receivedFrom !== undefined) {
    chips.push({ key: "receivedFrom", label: `Recibidos desde: ${filters.receivedFrom}` });
  }
  if (filters.receivedTo !== undefined) {
    chips.push({ key: "receivedTo", label: `Recibidos hasta: ${filters.receivedTo}` });
  }
  for (const skill of filters.skills) {
    chips.push({ key: `skill:${skill}`, label: `Habilidad: ${skill}` });
  }
  const bucket = experienceBucketValue(filters);
  if (bucket !== undefined) {
    const definition = PIPELINE_EXPERIENCE_BUCKETS.find((item) => item.value === bucket);
    chips.push({ key: `experience:${bucket}`, label: `Experiencia: ${definition?.label ?? bucket}` });
  }
  return chips;
}

/** Number of active criteria, shown on the toolbar filter button. */
export function countActivePipelineFilters(filters: PipelineFilters): number {
  return describePipelineFilters(filters).length;
}

function withoutValue<T>(values: readonly T[], value: T): readonly T[] {
  return values.filter((item) => item !== value);
}

/** Removes exactly one active criterion and leaves the rest untouched. */
export function removePipelineFilter(
  filters: PipelineFilters,
  key: string,
): PipelineFilters {
  if (key === "query") return { ...filters, query: "" };
  if (key === "receivedFrom") return { ...filters, receivedFrom: undefined };
  if (key === "receivedTo") return { ...filters, receivedTo: undefined };
  if (key.startsWith("experience:")) {
    return { ...filters, experienceMin: undefined, experienceMax: undefined };
  }
  const separator = key.indexOf(":");
  if (separator === -1) return filters;
  const facet = key.slice(0, separator);
  const value = key.slice(separator + 1);
  switch (facet) {
    case "status":
      return { ...filters, statuses: withoutValue(filters.statuses, value as CandidateStatus) };
    case "source":
      return { ...filters, sources: withoutValue(filters.sources, value as CandidateSource) };
    case "skill":
      return { ...filters, skills: withoutValue(filters.skills, value) };
    default:
      return filters;
  }
}

/** The experience bucket a pair of bounds represents, when it matches one. */
export function experienceBucketValue(
  filters: PipelineFilters,
): PipelineExperienceBucketValue | undefined {
  return PIPELINE_EXPERIENCE_BUCKETS.find(
    (bucket) => filters.experienceMin === bucket.min && filters.experienceMax === bucket.max,
  )?.value;
}

/** Applies (or clears) one experience bucket. */
export function applyExperienceBucket(
  filters: PipelineFilters,
  value: PipelineExperienceBucketValue | undefined,
): PipelineFilters {
  const bucket = PIPELINE_EXPERIENCE_BUCKETS.find((item) => item.value === value);
  return {
    ...filters,
    experienceMin: bucket?.min,
    experienceMax: bucket?.max,
  };
}

/**
 * True when both bounds are set and the lower day is later than the upper one.
 * The predicate only reports the inversion; the bounds are never swapped, so
 * the person sees exactly what they typed and can correct it.
 */
export function isReceivedRangeReversed(filters: PipelineFilters): boolean {
  return (
    filters.receivedFrom !== undefined &&
    filters.receivedTo !== undefined &&
    filters.receivedFrom > filters.receivedTo
  );
}

/** Honest list empty copy: no input at all differs from a filter hiding everything. */
export function pipelineListEmptyCopy(filters: PipelineFilters): string {
  if (!hasActivePipelineFilters(filters)) return "Sin candidatos en esta vacante.";
  if (filters.query.trim() !== "") return "Sin candidatos que coincidan con la búsqueda.";
  return "Sin candidatos que coincidan con los filtros.";
}

/** Recovery copy that names the search query when there is one, or the filters otherwise. */
export function pipelineNoResultsCopy(filters: PipelineFilters): string {
  const query = filters.query.trim();
  if (query !== "") return `No hay candidatos que coincidan con la búsqueda «${query}».`;
  return "No hay candidatos que coincidan con los filtros aplicados.";
}
