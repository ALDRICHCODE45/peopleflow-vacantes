import { z } from "zod";
import { phoneSchema } from "@/lib/phone";
import { locationReadSchema } from "@/features/geo/model";
import { normalizeSkills } from "@/lib/skills";

/**
 * Prototype candidate model for the `/candidato` workspace. It owns the strict
 * identity and self-service profile contracts plus the closed education,
 * salary-period, and CEFR vocabularies the backend enforces. It imports only
 * zod and shared geo/phone contracts: no React, browser API, transport, storage, auth, route, or employer
 * feature layer is reachable from here, and nothing is fetched or persisted.
 */

/** Mexican education levels in ascending order; completion is a separate status. */
export const EDUCATION_LEVELS = ["secondary", "high_school", "technical", "tsu", "bachelor", "specialty", "master", "phd"] as const;
export const SENIORITIES = ["intern", "junior", "semi_senior", "senior", "lead", "manager", "director"] as const;
export const SENIORITY_LABELS = Object.freeze({ intern: "Practicante", junior: "Junior", semi_senior: "Semi-senior", senior: "Senior", lead: "Líder", manager: "Gerente", director: "Director" });
export const EDUCATION_STATUSES = ["in_progress", "paused", "completed", "incomplete"] as const;
export const EDUCATION_STATUS_LABELS = Object.freeze({ in_progress: "En curso", paused: "En pausa", completed: "Concluido", incomplete: "Trunco" });
export const yearsOfExperienceSchema = z.string().regex(/^(0|[1-9][0-9]?)(\.[0-9])?$/).refine(value => Number(value) <= 60);
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** How often an expected salary is quoted; mirrors the backend parser. */
export const SALARY_PERIODS = ["monthly", "annual"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Exact, case-sensitive CEFR levels; lowercase codes are rejected on purpose. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Spanish display labels for the closed education vocabulary. */
export const EDUCATION_LEVEL_LABELS: Readonly<Record<EducationLevel, string>> = Object.freeze({
  secondary: "Secundaria",
  high_school: "Bachillerato o Preparatoria",
  technical: "Carrera técnica",
  tsu: "Técnico Superior Universitario (TSU)",
  bachelor: "Licenciatura o Ingeniería",
  specialty: "Especialidad",
  master: "Maestría",
  phd: "Doctorado",
});

/** Spanish display labels for the closed salary-period vocabulary. */
export const SALARY_PERIOD_LABELS: Readonly<Record<SalaryPeriod, string>> = Object.freeze({
  monthly: "Mensual",
  annual: "Anual",
});

/** Spanish display labels for the closed CEFR vocabulary. */
export const CEFR_LEVEL_LABELS: Readonly<Record<CefrLevel, string>> = Object.freeze({
  A1: "A1 · Principiante",
  A2: "A2 · Básico",
  B1: "B1 · Intermedio",
  B2: "B2 · Intermedio alto",
  C1: "C1 · Avanzado",
  C2: "C2 · Dominio",
  native: "Nativo",
});

const MAX_URL = 300;
const MAX_TEXT = 2000;
const MAX_MONEY = 100_000_000;

/** Education text is trimmed and bounded in code points, not UTF-16 units. */
const educationText = z.string().trim().min(1).refine(value => Array.from(value).length <= 120, "Usa hasta 120 caracteres.").nullable();
const educationYear = z.number().int().min(1950).max(2100).nullable();
export const educationSchema = z.object({
  level: z.enum(EDUCATION_LEVELS), institution: educationText, field: educationText,
  status: z.enum(EDUCATION_STATUSES), start_year: educationYear, end_year: educationYear,
}).strict().superRefine((study, context) => {
  if (study.status === "in_progress" && study.end_year !== null) context.addIssue({ code: "custom", path: ["end_year"], message: "Un estudio en curso no puede tener año de fin." });
  if (study.start_year !== null && study.end_year !== null && study.start_year > study.end_year) context.addIssue({ code: "custom", path: ["end_year"], message: "El año de fin debe ser igual o posterior al de inicio." });
});
export type Education = z.infer<typeof educationSchema>;
const salaryPeriodSchema = z.string().trim().toLowerCase().pipe(z.enum(SALARY_PERIODS));

/**
 * Strict identity of the signed-in candidate. Only the fields the prototype
 * needs are modelled; Cognito, session, and auth state are intentionally absent.
 */
export const candidateIdentitySchema = z
  .object({
    userId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email().max(160),
    fullName: z.string().trim().min(2).max(120),
    userType: z.literal("candidate"),
  })
  .strict();
export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>;

/** Language codes are opaque; membership belongs to the catalog/backend, never a regex. */
export const candidateLanguageSchema = z
  .object({
    code: z.string().min(1),
    level: z.enum(CEFR_LEVELS),
  })
  .strict();
export type CandidateLanguage = z.infer<typeof candidateLanguageSchema>;

/** Canonical skills: typed casing, trimmed, empty dropped, deduped case-insensitively. */
const skillsSchema = z
  .array(z.string().max(60))
  .max(60)
  .transform((values) => normalizeSkills(values));

/** Up to ten distinct catalog codes; duplicates preserve the offending row index. */
const languagesSchema = z
  .array(candidateLanguageSchema)
  .max(10)
  .superRefine((languages, context) => {
    const seen = new Set<string>();
    for (const [index, language] of languages.entries()) {
      if (seen.has(language.code)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "code"], message: "Este idioma ya está agregado." });
      }
      seen.add(language.code);
    }
  });

const optionalTextSchema = z.string().trim().min(1).max(120).nullable();
const optionalUrlSchema = z.string().trim().url().max(MAX_URL).nullable();
const optionalMoneySchema = z.number().int().nonnegative().max(MAX_MONEY).nullable();

/**
 * Strict self-service candidate profile. It mirrors the fields the existing
 * `/me/profile` response exposes and never models the reserved server-side CV
 * storage key. Currency stays a bounded three-letter code because the backend
 * declares no currency closed set.
 */
export const candidateProfileSchema = z
  .object({
    phone: phoneSchema.nullable(),
    linkedinUrl: optionalUrlSchema,
    portfolioUrl: optionalUrlSchema,
    professionalTitle: optionalTextSchema,
    currentCompany: optionalTextSchema,
    yearsOfExperience: yearsOfExperienceSchema.nullable(),
    seniority: z.enum(SENIORITIES).nullable(),
    summary: z.string().trim().min(1).max(MAX_TEXT).nullable(),
    birthDate: z.string().date().nullable(),
    location: locationReadSchema,
    education: z.array(educationSchema).max(10),
    skills: skillsSchema,
    currentSalaryGross: optionalMoneySchema,
    currentSalaryNet: optionalMoneySchema,
    expectedSalary: optionalMoneySchema,
    salaryCurrency: z.string().trim().length(3),
    expectedSalaryPeriod: salaryPeriodSchema.nullable(),
    languages: languagesSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

/** Parses untrusted fixture data into the validated prototype candidate profile. */
export function parseCandidateProfile(input: unknown): CandidateProfile {
  return candidateProfileSchema.parse(input);
}
