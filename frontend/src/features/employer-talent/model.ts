import { z } from "zod";

import {
  EMPLOYER_WORK_MODES,
  VACANCY_PIPELINE_STAGES,
  type EmployerWorkMode,
  type VacancyPipelineStage,
} from "@/features/employer-vacancies/model";
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies";

/**
 * Prototype-only model for the employer talent base (`/empresa/talento`).
 *
 * One row is one stable unique person; every application is a separate record
 * under that person. The module owns closed local vocabularies, keeps status on
 * the application (never on the person) and imports only zod plus the frozen
 * employer vacancy vocabulary: no transport, storage, React or browser API can
 * reach it, and nothing is persisted.
 */

/** Application stage reuses the committed application vocabulary. */
export const TALENT_STAGES = VACANCY_PIPELINE_STAGES;
export type TalentStage = VacancyPipelineStage;

/** Spanish singular labels: status always reads on one application. */
export const TALENT_STAGE_LABELS: Readonly<Record<TalentStage, string>> = Object.freeze({
  submitted: "Nuevo",
  in_review: "En revisión",
  hired: "Contratado",
  rejected: "Descartado",
});

/** Application origin vocabulary, declared locally to this feature. */
export const TALENT_SOURCES = ["direct", "referral", "linkedin", "job_board", "other"] as const;
export type TalentSource = (typeof TALENT_SOURCES)[number];

export const TALENT_SOURCE_LABELS: Readonly<Record<TalentSource, string>> = Object.freeze({
  direct: "Postulación directa",
  referral: "Referido",
  linkedin: "LinkedIn",
  job_board: "Portal de empleo",
  other: "Otro",
});

/** Work arrangement, reusing the employer vacancy vocabulary. */
export const TALENT_MODALITIES = EMPLOYER_WORK_MODES;
export type TalentModality = EmployerWorkMode;

export const TALENT_MODALITY_LABELS: Readonly<Record<TalentModality, string>> = Object.freeze({
  onsite: "Presencial",
  remote: "Remoto",
  hybrid: "Híbrido",
});

/** Candidate availability, declared locally to this feature. */
export const TALENT_AVAILABILITIES = ["immediate", "two_weeks", "one_month", "to_confirm"] as const;
export type TalentAvailability = (typeof TALENT_AVAILABILITIES)[number];

export const TALENT_AVAILABILITY_LABELS: Readonly<Record<TalentAvailability, string>> = Object.freeze({
  immediate: "Disponibilidad inmediata",
  two_weeks: "En dos semanas",
  one_month: "En un mes",
  to_confirm: "Por confirmar",
});

export const TALENT_LANGUAGE_LEVELS = ["basic", "intermediate", "advanced", "native"] as const;
export type TalentLanguageLevel = (typeof TALENT_LANGUAGE_LEVELS)[number];

export const TALENT_LANGUAGE_LEVEL_LABELS: Readonly<Record<TalentLanguageLevel, string>> = Object.freeze({
  basic: "Básico",
  intermediate: "Intermedio",
  advanced: "Avanzado",
  native: "Nativo",
});

/** Selectable industries. */
export const TALENT_INDUSTRIES = [
  "Tecnología",
  "Fintech",
  "Salud",
  "Educación",
  "Comercio",
  "Logística",
  "Manufactura",
] as const;
export type TalentIndustry = (typeof TALENT_INDUSTRIES)[number];

/** Selectable Mexican work locations. */
export const TALENT_LOCATIONS = [
  "Guadalajara",
  "CDMX",
  "Monterrey",
  "Puebla",
  "Querétaro",
  "Mérida",
  "Tijuana",
  "León",
] as const;
export type TalentLocation = (typeof TALENT_LOCATIONS)[number];

/** Canonical skill vocabulary: every fixture skill resolves to a filter option. */
export const TALENT_SKILLS = [
  "React",
  "Next.js",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Go",
  "Java",
  "Spring",
  "Python",
  "SQL",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "GraphQL",
  "AWS",
  "Docker",
  "Kubernetes",
  "Terraform",
  "CI/CD",
  "Testing",
  "Playwright",
  "Tailwind CSS",
  "Figma",
  "UX",
  "Scrum",
] as const;
export type TalentSkill = (typeof TALENT_SKILLS)[number];

/** Closed experience buckets used by the single-select experience filter. */
export const TALENT_EXPERIENCE_BUCKETS = [
  { value: "0-2", label: "Hasta 2 años", min: 0, max: 2 },
  { value: "3-5", label: "3 a 5 años", min: 3, max: 5 },
  { value: "6-9", label: "6 a 9 años", min: 6, max: 9 },
  { value: "10+", label: "10 años o más", min: 10, max: 60 },
] as const;
export type TalentExperienceBucketValue = (typeof TALENT_EXPERIENCE_BUCKETS)[number]["value"];

/** Stable employer vacancy ids the applications reference. */
export const TALENT_EMPLOYER_VACANCY_IDS: readonly string[] = Object.freeze(
  NEXO_VACANCIES.map((vacancy) => vacancy.id),
);

/** Vacancy id to its display title, so filters and history read real names. */
export const TALENT_VACANCY_TITLES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(NEXO_VACANCIES.map((vacancy) => [vacancy.id, vacancy.title])),
);

/** One language attached to a person. */
export type TalentLanguage = {
  readonly name: string;
  readonly level: TalentLanguageLevel;
};

/** One separate application record; status lives here, never on the person. */
export type TalentApplication = {
  readonly id: string;
  readonly vacancyId: string;
  readonly stage: TalentStage;
  readonly source: TalentSource;
  /** UTC ISO timestamp the application was received at. */
  readonly appliedAt: string;
};

/** One stable unique person holding one or more application records. */
export type TalentPerson = {
  readonly id: string;
  readonly fullName: string;
  readonly professionalTitle: string;
  readonly email: string;
  readonly phone: string;
  readonly location: TalentLocation;
  readonly industry: TalentIndustry;
  readonly currentCompany: string;
  readonly yearsOfExperience: number;
  readonly skills: readonly TalentSkill[];
  readonly education: string;
  readonly languages: readonly TalentLanguage[];
  readonly preferredModality: TalentModality;
  readonly availability: TalentAvailability;
  readonly applications: readonly TalentApplication[];
};

const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64);
const personTextSchema = z.string().trim().min(1).max(120);
const utcIsoDateTime = z.string().datetime();

export const talentLanguageSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    level: z.enum(TALENT_LANGUAGE_LEVELS),
  })
  .strict();

export const talentApplicationSchema = z
  .object({
    id: slugSchema,
    vacancyId: slugSchema,
    stage: z.enum(TALENT_STAGES),
    source: z.enum(TALENT_SOURCES),
    appliedAt: utcIsoDateTime,
  })
  .strict();

/**
 * Validates one person. Strict on purpose: a fabricated person-level status or
 * match score, duplicate application id, empty history, unknown vocabulary
 * value or extra key is a fixture bug that must fail at the module boundary.
 */
export const talentPersonSchema = z
  .object({
    id: slugSchema,
    fullName: personTextSchema,
    professionalTitle: personTextSchema,
    email: z.string().trim().email().max(120),
    phone: z.string().trim().min(5).max(30),
    location: z.enum(TALENT_LOCATIONS),
    industry: z.enum(TALENT_INDUSTRIES),
    currentCompany: personTextSchema,
    yearsOfExperience: z.number().int().min(0).max(60),
    skills: z.array(z.enum(TALENT_SKILLS)).min(1).max(8),
    education: personTextSchema,
    languages: z.array(talentLanguageSchema).min(1).max(4),
    preferredModality: z.enum(TALENT_MODALITIES),
    availability: z.enum(TALENT_AVAILABILITIES),
    applications: z.array(talentApplicationSchema).min(1).max(4),
  })
  .strict()
  .superRefine((person, context) => {
    const ids = person.applications.map((application) => application.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["applications"],
        message: "application ids must be unique inside a person",
      });
    }
  });

export const talentPeopleSchema = z.array(talentPersonSchema).max(500);

/** Parses untrusted fixture data into validated people. */
export function parseTalentPeople(input: unknown): readonly TalentPerson[] {
  return talentPeopleSchema.parse(input);
}

/** Complete filter state of the talent base; every facet is optional. */
export type TalentFilters = {
  readonly query: string;
  readonly positions: readonly string[];
  readonly stages: readonly TalentStage[];
  readonly sources: readonly TalentSource[];
  readonly appliedFrom: string | undefined;
  readonly appliedTo: string | undefined;
  readonly industries: readonly TalentIndustry[];
  readonly locations: readonly TalentLocation[];
  readonly skills: readonly TalentSkill[];
  readonly modalities: readonly TalentModality[];
  readonly availability: readonly TalentAvailability[];
  readonly experienceMin: number | undefined;
  readonly experienceMax: number | undefined;
};

export function createEmptyTalentFilters(): TalentFilters {
  return {
    query: "",
    positions: [],
    stages: [],
    sources: [],
    appliedFrom: undefined,
    appliedTo: undefined,
    industries: [],
    locations: [],
    skills: [],
    modalities: [],
    availability: [],
    experienceMin: undefined,
    experienceMax: undefined,
  };
}

/** Diacritic- and case-insensitive search normalization. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim();
}

/** Application-level criteria: OR inside a facet, AND across facets. */
export function talentApplicationMatches(
  application: TalentApplication,
  filters: TalentFilters,
): boolean {
  if (filters.positions.length && !filters.positions.includes(application.vacancyId)) return false;
  if (filters.stages.length && !filters.stages.includes(application.stage)) return false;
  if (filters.sources.length && !filters.sources.includes(application.source)) return false;
  const appliedDay = application.appliedAt.slice(0, 10);
  if (filters.appliedFrom && appliedDay < filters.appliedFrom) return false;
  if (filters.appliedTo && appliedDay > filters.appliedTo) return false;
  return true;
}

/** Whether any criterion filters on a single application record. */
export function hasApplicationLevelFilters(filters: TalentFilters): boolean {
  return (
    filters.positions.length > 0 ||
    filters.stages.length > 0 ||
    filters.sources.length > 0 ||
    Boolean(filters.appliedFrom) ||
    Boolean(filters.appliedTo)
  );
}

function talentPersonMatchesQuery(person: TalentPerson, query: string): boolean {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  const haystack = normalizeSearchText(
    [
      person.fullName,
      person.professionalTitle,
      person.currentCompany,
      person.location,
      person.industry,
      person.education,
      ...person.skills,
      ...person.languages.map((language) => language.name),
    ].join(" "),
  );
  return normalized.split(/\s+/u).every((token) => haystack.includes(token));
}

function talentPersonMatchesPersonFacets(
  person: TalentPerson,
  filters: TalentFilters,
): boolean {
  if (!talentPersonMatchesQuery(person, filters.query)) return false;
  if (filters.industries.length && !filters.industries.includes(person.industry)) return false;
  if (filters.locations.length && !filters.locations.includes(person.location)) return false;
  if (filters.modalities.length && !filters.modalities.includes(person.preferredModality)) return false;
  if (filters.availability.length && !filters.availability.includes(person.availability)) return false;
  if (filters.skills.length && !person.skills.some((skill) => filters.skills.includes(skill))) {
    return false;
  }
  if (filters.experienceMin !== undefined && person.yearsOfExperience < filters.experienceMin) {
    return false;
  }
  if (filters.experienceMax !== undefined && person.yearsOfExperience > filters.experienceMax) {
    return false;
  }
  return true;
}

/**
 * A person matches when every person-level facet passes AND, if any
 * application-level criterion is active, at least one single application
 * satisfies all of them at once. Application criteria never combine across two
 * different applications.
 */
export function talentPersonMatchesFilters(
  person: TalentPerson,
  filters: TalentFilters,
): boolean {
  if (!talentPersonMatchesPersonFacets(person, filters)) return false;
  if (!hasApplicationLevelFilters(filters)) return true;
  return person.applications.some((application) =>
    talentApplicationMatches(application, filters),
  );
}

export function filterTalentPeople(
  people: readonly TalentPerson[],
  filters: TalentFilters,
): readonly TalentPerson[] {
  return people.filter((person) => talentPersonMatchesFilters(person, filters));
}

/** Whole-base counters shown above the table; never derived from a filter. */
export type TalentGlobalTotals = {
  readonly people: number;
  readonly applications: number;
  readonly immediate: number;
  readonly vacancies: number;
};

/**
 * Counts the complete person set, not a filtered projection: an immediate
 * person counts once no matter how many applications they hold, and a vacancy
 * repeated across people or applications counts once.
 */
export function computeTalentTotals(
  people: readonly TalentPerson[],
): TalentGlobalTotals {
  let applications = 0;
  let immediate = 0;
  const vacancies = new Set<string>();
  for (const person of people) {
    applications += person.applications.length;
    if (person.availability === "immediate") immediate += 1;
    for (const application of person.applications) {
      vacancies.add(application.vacancyId);
    }
  }
  return {
    people: people.length,
    applications,
    immediate,
    vacancies: vacancies.size,
  };
}

/** Applications of one person, most recent first. */
export function applicationsByMostRecent(person: TalentPerson): readonly TalentApplication[] {
  return [...person.applications].sort((left, right) =>
    right.appliedAt.localeCompare(left.appliedAt),
  );
}

export function talentLastApplicationAt(person: TalentPerson): string | undefined {
  return applicationsByMostRecent(person)[0]?.appliedAt;
}

/** Formatting helper pinned to UTC so no application shifts a day. */
export function formatTalentDate(value: string): string {
  return new Date(value).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatTalentApplicationsCount(count: number): string {
  return count === 1 ? "1 postulación" : `${count} postulaciones`;
}

export function formatTalentYears(years: number): string {
  return years === 1 ? "1 año" : `${years} años`;
}

/** Initials fallback for the avatar; first and last word. */
export function talentFullNameInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

/** One removable active-filter chip. */
export type TalentFilterChip = {
  readonly key: string;
  readonly label: string;
};

/** Every active criterion as a removable chip, in a stable order. */
export function describeTalentFilters(
  filters: TalentFilters,
  vacancyTitleById: Readonly<Record<string, string>>,
): readonly TalentFilterChip[] {
  const chips: TalentFilterChip[] = [];
  if (filters.query.trim()) {
    chips.push({ key: "query", label: `Búsqueda: ${filters.query.trim()}` });
  }
  for (const position of filters.positions) {
    chips.push({
      key: `position:${position}`,
      label: `Puesto: ${vacancyTitleById[position] ?? position}`,
    });
  }
  for (const stage of filters.stages) {
    chips.push({ key: `stage:${stage}`, label: `Etapa: ${TALENT_STAGE_LABELS[stage]}` });
  }
  for (const source of filters.sources) {
    chips.push({ key: `source:${source}`, label: `Origen: ${TALENT_SOURCE_LABELS[source]}` });
  }
  if (filters.appliedFrom) {
    chips.push({ key: "appliedFrom", label: `Postuladas desde: ${filters.appliedFrom}` });
  }
  if (filters.appliedTo) {
    chips.push({ key: "appliedTo", label: `Postuladas hasta: ${filters.appliedTo}` });
  }
  for (const industry of filters.industries) {
    chips.push({ key: `industry:${industry}`, label: `Industria: ${industry}` });
  }
  for (const location of filters.locations) {
    chips.push({ key: `location:${location}`, label: `Ubicación: ${location}` });
  }
  for (const skill of filters.skills) {
    chips.push({ key: `skill:${skill}`, label: `Habilidad: ${skill}` });
  }
  for (const modality of filters.modalities) {
    chips.push({ key: `modality:${modality}`, label: `Modalidad: ${TALENT_MODALITY_LABELS[modality]}` });
  }
  for (const availability of filters.availability) {
    chips.push({
      key: `availability:${availability}`,
      label: `Disponibilidad: ${TALENT_AVAILABILITY_LABELS[availability]}`,
    });
  }
  const bucket = experienceBucketValue(filters);
  if (bucket !== undefined) {
    const definition = TALENT_EXPERIENCE_BUCKETS.find((item) => item.value === bucket);
    chips.push({
      key: `experience:${bucket}`,
      label: `Experiencia: ${definition?.label ?? bucket}`,
    });
  }
  return chips;
}

export function countActiveTalentFilters(filters: TalentFilters): number {
  return describeTalentFilters(filters, {}).length;
}

function withoutValue<T>(values: readonly T[], value: T): readonly T[] {
  return values.filter((item) => item !== value);
}

/** Removes exactly one active criterion, leaving the rest untouched. */
export function removeTalentFilter(filters: TalentFilters, key: string): TalentFilters {
  if (key === "query") return { ...filters, query: "" };
  if (key === "appliedFrom") return { ...filters, appliedFrom: undefined };
  if (key === "appliedTo") return { ...filters, appliedTo: undefined };
  if (key.startsWith("experience:")) {
    return { ...filters, experienceMin: undefined, experienceMax: undefined };
  }
  const [facet, ...rest] = key.split(":");
  const value = rest.join(":");
  switch (facet) {
    case "position":
      return { ...filters, positions: withoutValue(filters.positions, value) };
    case "stage":
      return { ...filters, stages: withoutValue(filters.stages, value as TalentStage) };
    case "source":
      return { ...filters, sources: withoutValue(filters.sources, value as TalentSource) };
    case "industry":
      return { ...filters, industries: withoutValue(filters.industries, value as TalentIndustry) };
    case "location":
      return { ...filters, locations: withoutValue(filters.locations, value as TalentLocation) };
    case "skill":
      return { ...filters, skills: withoutValue(filters.skills, value as TalentSkill) };
    case "modality":
      return { ...filters, modalities: withoutValue(filters.modalities, value as TalentModality) };
    case "availability":
      return {
        ...filters,
        availability: withoutValue(filters.availability, value as TalentAvailability),
      };
    default:
      return filters;
  }
}

/** The experience bucket a pair of bounds represents, when it matches one. */
export function experienceBucketValue(filters: TalentFilters): TalentExperienceBucketValue | undefined {
  return TALENT_EXPERIENCE_BUCKETS.find(
    (bucket) => filters.experienceMin === bucket.min && filters.experienceMax === bucket.max,
  )?.value;
}

/** Applies (or clears) an experience bucket. */
export function applyExperienceBucket(
  filters: TalentFilters,
  value: TalentExperienceBucketValue | undefined,
): TalentFilters {
  const bucket = TALENT_EXPERIENCE_BUCKETS.find((item) => item.value === value);
  return {
    ...filters,
    experienceMin: bucket?.min,
    experienceMax: bucket?.max,
  };
}

/** Ordered column ids of the talent table. */
export const TALENT_COLUMN_IDS = [
  "fullName",
  "professionalTitle",
  "currentCompany",
  "industry",
  "location",
  "yearsOfExperience",
  "skills",
  "preferredModality",
  "availability",
  "applicationsCount",
  "lastApplicationAt",
  "email",
  "phone",
  "education",
  "languages",
] as const;
export type TalentColumnId = (typeof TALENT_COLUMN_IDS)[number];

export const TALENT_COLUMN_LABELS: Readonly<Record<TalentColumnId, string>> = Object.freeze({
  fullName: "Persona",
  professionalTitle: "Puesto actual",
  currentCompany: "Empresa actual",
  industry: "Industria",
  location: "Ubicación",
  yearsOfExperience: "Experiencia",
  skills: "Habilidades",
  preferredModality: "Modalidad",
  availability: "Disponibilidad",
  applicationsCount: "Postulaciones",
  lastApplicationAt: "Última postulación",
  email: "Correo",
  phone: "Teléfono",
  education: "Formación",
  languages: "Idiomas",
});

/** Progressive detail: advanced columns start hidden. */
const HIDDEN_BY_DEFAULT: readonly TalentColumnId[] = [
  "currentCompany",
  "email",
  "phone",
  "education",
  "languages",
];

export const TALENT_COLUMN_DEFAULT_VISIBILITY: Readonly<Record<TalentColumnId, boolean>> =
  Object.freeze(
    Object.fromEntries(
      TALENT_COLUMN_IDS.map((id) => [id, !HIDDEN_BY_DEFAULT.includes(id)]),
    ) as Record<TalentColumnId, boolean>,
  );

/** The identity column starts pinned to the start region. */
export const DEFAULT_TALENT_COLUMN_PINNING: {
  readonly start: readonly string[];
  readonly end: readonly string[];
} = Object.freeze({ start: ["fullName"], end: [] });

/** One pixel sizing source: every column has an explicit width. */
export const TALENT_COLUMN_SIZES: Readonly<Record<TalentColumnId, number>> = Object.freeze({
  fullName: 240,
  professionalTitle: 210,
  currentCompany: 200,
  industry: 150,
  location: 150,
  yearsOfExperience: 130,
  skills: 260,
  preferredModality: 150,
  availability: 170,
  applicationsCount: 150,
  lastApplicationAt: 170,
  email: 230,
  phone: 170,
  education: 280,
  languages: 210,
});

export type TalentColumnPinning = {
  readonly start: readonly string[];
  readonly end: readonly string[];
};

export function regionOfTalentColumn(
  pinning: TalentColumnPinning,
  id: string,
): "start" | "end" | "center" {
  if (pinning.start.includes(id)) return "start";
  if (pinning.end.includes(id)) return "end";
  return "center";
}

/** Swaps an id with its neighbor in the given direction, clamping at the edges. */
export function moveIdWithin(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const next = [...ids];
  if (index < 0) return next;
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Moves an id to the start or end of its list. */
export function moveIdToEdge(ids: readonly string[], id: string, edge: "start" | "end"): string[] {
  if (!ids.includes(id)) return [...ids];
  const rest = ids.filter((item) => item !== id);
  return edge === "start" ? [id, ...rest] : [...rest, id];
}

/** Moves an id to an explicit index, clamped to the list bounds. */
export function moveIdToIndex(ids: readonly string[], id: string, index: number): string[] {
  const current = ids.indexOf(id);
  if (current < 0) return [...ids];
  const rest = ids.filter((item) => item !== id);
  const clamped = Math.max(0, Math.min(index, rest.length));
  rest.splice(clamped, 0, id);
  return rest;
}
