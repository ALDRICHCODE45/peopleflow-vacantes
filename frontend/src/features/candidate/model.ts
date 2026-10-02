import { z } from "zod";

/**
 * Prototype candidate model for the `/candidato` workspace. It owns the strict
 * identity and self-service profile contracts plus the closed education,
 * salary-period, and CEFR vocabularies the backend enforces. It imports only
 * zod: no React, browser API, transport, storage, auth, route, or employer
 * feature layer is reachable from here, and nothing is fetched or persisted.
 */

/** Highest academic level a candidate can declare; mirrors the backend parser. */
export const EDUCATION_LEVELS = ["high_school", "bachelor", "master", "phd"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** How often an expected salary is quoted; mirrors the backend parser. */
export const SALARY_PERIODS = ["monthly", "annual"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Exact, case-sensitive CEFR levels; lowercase codes are rejected on purpose. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Spanish display labels for the closed education vocabulary. */
export const EDUCATION_LEVEL_LABELS: Readonly<Record<EducationLevel, string>> = Object.freeze({
  high_school: "Preparatoria",
  bachelor: "Licenciatura",
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
  A1: "Principiante",
  A2: "Elemental",
  B1: "Intermedio",
  B2: "Intermedio alto",
  C1: "Avanzado",
  C2: "Dominio",
});

const MAX_URL = 300;
const MAX_TEXT = 2000;
const MAX_MONEY = 100_000_000;

/** Closed set that also accepts surrounding whitespace and any case, mirroring the backend parsers. */
const educationLevelSchema = z.string().trim().toLowerCase().pipe(z.enum(EDUCATION_LEVELS));
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

/**
 * One declared language: the name is lowercased and trimmed, while the CEFR
 * level stays exact uppercase (a lowercase code is a fixture bug, not a synonym).
 */
export const candidateLanguageSchema = z
  .object({
    name: z.string().trim().min(1).max(60).transform((name) => name.toLowerCase()),
    level: z.enum(CEFR_LEVELS),
  })
  .strict();
export type CandidateLanguage = z.infer<typeof candidateLanguageSchema>;

/** Canonical skills: lowercase, trimmed, empty dropped, deduped by first occurrence. */
const skillsSchema = z
  .array(z.string().max(60))
  .max(60)
  .transform((values) => {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
      const skill = value.trim().toLowerCase();
      if (skill === "" || seen.has(skill)) continue;
      seen.add(skill);
      normalized.push(skill);
    }
    return normalized;
  });

/** Languages with case-insensitive unique names; a repeat is a boundary error. */
const languagesSchema = z
  .array(candidateLanguageSchema)
  .max(20)
  .superRefine((languages, context) => {
    const seen = new Set<string>();
    for (const [index, language] of languages.entries()) {
      if (seen.has(language.name)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "name"], message: `duplicate language: ${language.name}` });
      }
      seen.add(language.name);
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
    phone: z.string().trim().min(5).max(30).nullable(),
    linkedinUrl: optionalUrlSchema,
    portfolioUrl: optionalUrlSchema,
    professionalTitle: optionalTextSchema,
    currentCompany: optionalTextSchema,
    yearsOfExperience: z.number().int().nonnegative().max(60).nullable(),
    summary: z.string().trim().min(1).max(MAX_TEXT).nullable(),
    birthDate: z.string().date().nullable(),
    city: optionalTextSchema,
    country: optionalTextSchema,
    educationLevel: educationLevelSchema.nullable(),
    fieldOfStudy: z.string().trim().min(1).max(120).nullable(),
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
