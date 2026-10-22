import { z } from "zod";

import { compensationSchema, createCompensationDefaults } from "./compensation";
import { draftListFieldSchemas } from "./lists";
import { draftNestedFieldSchemas } from "./nested";
import { draftRichDescriptionSchema } from "./rich/description";
import { draftScalarFieldSchemas } from "./scalars";

/**
 * Private draft write-body composition, contract §2.1 / §4–§5.
 * These schemas accept decoded values, not raw JSON or HTTP requests. They do
 * not enforce byte-before-decode limits, duplicate keys, authentication, headers,
 * requester ownership or server fingerprints. Backend validation is authoritative.
 */
const completeFieldsSchema = z.object({
  ...draftScalarFieldSchemas,
  ...draftListFieldSchemas,
  ...draftNestedFieldSchemas,
  compensation: compensationSchema,
  description: draftRichDescriptionSchema,
}).strict();

type CompleteFields = z.output<typeof completeFieldsSchema>;

// Partial applies only to top-level field presence, never nested replacement
// values. Explicit undefined is not a wire value and must not erase a PATCH.
const suppliedFieldsSchema = completeFieldsSchema.partial().superRefine((fields, context) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "explicit undefined is not a draft field value",
      });
    }
  }
});

/** Apply omission defaults only after every supplied value has validated. */
function fillPostFields(fields: z.output<typeof suppliedFieldsSchema>): CompleteFields {
  return {
    title: fields.title ?? null,
    location: fields.location ?? null,
    remote_scope: fields.remote_scope ?? null,
    work_mode: fields.work_mode ?? null,
    work_schedule: fields.work_schedule ?? null,
    contract_type: fields.contract_type ?? null,
    seniority: fields.seniority ?? null,
    min_years_of_experience: fields.min_years_of_experience ?? null,
    min_education_level: fields.min_education_level ?? null,
    accepts_in_progress_education: fields.accepts_in_progress_education ?? false,
    professional_area: fields.professional_area ?? null,
    required_requirements: fields.required_requirements ?? null,
    preferred_requirements: fields.preferred_requirements ?? null,
    skills: fields.skills ?? [],
    custom_benefits: fields.custom_benefits ?? [],
    benefits: fields.benefits ?? [],
    screening_questions: fields.screening_questions ?? [],
    requester: fields.requester ?? null,
    languages: fields.languages ?? [],
    compensation: fields.compensation ?? createCompensationDefaults(),
    description: fields.description ?? null,
  };
}

/** POST requires `{fields}`; empty fields create a complete, fresh default value. */
export const draftPostBodySchema = z.object({
  fields: suppliedFieldsSchema.transform(fillPostFields),
}).strict();

/**
 * PATCH requires at least one field. The output retains exactly supplied keys;
 * each present value is a full replacement, without defaults or nested merging.
 * `empty_patch` is a validation discriminator, not an HTTP response mapper.
 */
export const draftPatchBodySchema = z.object({
  fields: suppliedFieldsSchema.superRefine((fields, context) => {
    if (Object.keys(fields).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "empty_patch",
        params: { kind: "empty_patch" },
      });
    }
  }),
}).strict();

/** Normalized complete POST body and presence-preserving PATCH body. */
export type DraftPostBody = z.output<typeof draftPostBodySchema>;
export type DraftPatchBody = z.output<typeof draftPatchBodySchema>;
