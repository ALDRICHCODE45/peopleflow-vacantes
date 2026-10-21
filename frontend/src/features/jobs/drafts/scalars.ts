import { z } from "zod";
import { EDUCATION_LEVELS, yearsOfExperienceSchema, SENIORITIES } from "@/features/candidate/model";
export { SENIORITIES } from "@/features/candidate/model";
import { locationWriteSchema, remoteScopeWriteSchema } from "@/features/geo/model";
import { trimUnicodeWhiteSpace } from "./text";

/**
 * Nine individual `fields.*` scalar validators for the private vacancy draft
 * slice (`docs/contracts/private-vacancy-drafts-v1.md` §3, §4, §4.1).
 *
 * Zod-only: no React, no transport, no server-only import. Each schema validates
 * exactly one field value, so a later composition unit owns `POST`/`PATCH`
 * omission semantics, unknown keys and the enclosing request body. These rules
 * mirror the accepted design; they are not a claim that the backend enforces
 * them yet, so a future backend unit must revalidate every one.
 */

const utf8Encoder = new TextEncoder();

/** Codepoint count: astral characters count as one, not two UTF-16 units. */
function countCodePoints(value: string): number {
  return [...value].length;
}

/** UTF-8 byte count over the already-trimmed value. */
function countUtf8Bytes(value: string): number {
  return utf8Encoder.encode(value).length;
}

type TextLimit = { codepoints?: number; bytes?: number };

/**
 * Nullable free text (§3): trimmed at the ends, empty becomes `null`, and any
 * limit is measured on the trimmed value. Non-strings and `undefined` are
 * rejected; `null` passes through unchanged. Oversize is an issue, never a
 * silent truncation. No default and no coercion is applied.
 */
const nullableTrimmedText = (limit: TextLimit) =>
  z
    .string()
    .nullable()
    .transform((value, context) => {
      if (value === null) return null;
      const trimmed = trimUnicodeWhiteSpace(value);
      if (trimmed.length === 0) return null;
      if (limit.codepoints !== undefined && countCodePoints(trimmed) > limit.codepoints) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "text exceeds codepoint limit" });
        return z.NEVER;
      }
      if (limit.bytes !== undefined && countUtf8Bytes(trimmed) > limit.bytes) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "text exceeds UTF-8 byte limit" });
        return z.NEVER;
      }
      return trimmed;
    });

/** Accepted `work_mode` literals; `null` is allowed. */
export const WORK_MODES = ["onsite", "remote", "hybrid"] as const;
/** Accepted `work_schedule` literals; `null` is allowed. */
export const WORK_SCHEDULES = ["full_time", "part_time"] as const;
/** Accepted `contract_type` literals; `null` is allowed. */
export const CONTRACT_TYPES = [
  "project",
  "indefinite",
  "professional_services",
  "temporary",
  "internship",
] as const;
/** Accepted `seniority` literals; `null` is allowed. No years mapping. */
export const draftMinYearsSchema = yearsOfExperienceSchema.refine(value => !/\s/u.test(value)).nullable();
export const draftMinEducationSchema = z.enum(EDUCATION_LEVELS).nullable();
/** Accepted `professional_area` codes (§4.1, REQ-7); `null` is allowed. */
export const PROFESSIONAL_AREAS = [
  "technology_systems",
  "engineering",
  "product",
  "design_creative",
  "sales_business_development",
  "marketing_communications",
  "administration_finance",
  "human_resources",
  "operations_production",
  "logistics_transport",
  "customer_service_support",
  "healthcare",
  "education_training",
  "legal",
  "construction_maintenance",
  "tourism_hospitality_gastronomy",
] as const;

/** `title`: nullable free text, trimmed at ends, ≤200 codepoints. */
export const draftTitleSchema = nullableTrimmedText({ codepoints: 200 });
/** Catalog-code geography; drafts may be incomplete. */
export const draftLocationSchema = locationWriteSchema;
/** `work_mode`: exact nullable literal, no trimming or coercion. */
export const draftWorkModeSchema = z.enum(WORK_MODES).nullable();
/** `work_schedule`: exact nullable literal, no trimming or coercion. */
export const draftWorkScheduleSchema = z.enum(WORK_SCHEDULES).nullable();
/** `contract_type`: exact nullable literal, no trimming or coercion. */
export const draftContractTypeSchema = z.enum(CONTRACT_TYPES).nullable();
/** `seniority`: exact nullable literal, no trimming or coercion. */
export const draftSenioritySchema = z.enum(SENIORITIES).nullable();
/** `professional_area`: exact nullable literal, no trimming or coercion. */
export const draftProfessionalAreaSchema = z.enum(PROFESSIONAL_AREAS).nullable();
/** `required_requirements`: nullable free text, trimmed at ends, ≤16384 UTF-8 bytes. */
export const draftRequiredRequirementsSchema = nullableTrimmedText({ bytes: 16384 });
/** `preferred_requirements`: nullable free text, trimmed at ends, ≤16384 UTF-8 bytes. */
export const draftPreferredRequirementsSchema = nullableTrimmedText({ bytes: 16384 });

/**
 * Reusable per-field schema map. Deliberately not a request parser: composing a
 * partial or complete `fields` object is a later unit's responsibility.
 */
export const draftScalarFieldSchemas = {
  title: draftTitleSchema,
  location: draftLocationSchema,
  remote_scope: remoteScopeWriteSchema,
  work_mode: draftWorkModeSchema,
  work_schedule: draftWorkScheduleSchema,
  contract_type: draftContractTypeSchema,
  seniority: draftSenioritySchema,
  min_years_of_experience: draftMinYearsSchema,
  min_education_level: draftMinEducationSchema,
  accepts_in_progress_education: z.boolean(),
  professional_area: draftProfessionalAreaSchema,
  required_requirements: draftRequiredRequirementsSchema,
  preferred_requirements: draftPreferredRequirementsSchema,
} as const;

/** One of the nine contract-defined scalar field names. */
export type DraftScalarField = keyof typeof draftScalarFieldSchemas;
