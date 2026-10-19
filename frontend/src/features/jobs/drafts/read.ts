import { z } from "zod";
import { locationReadSchema, remoteScopeReadSchema } from "@/features/geo/model";

import { compensationSchema } from "./compensation";
import { draftListFieldSchemas } from "./lists";
import { draftLanguagesSchema, draftRequesterSchema } from "./nested";
import { draftRichDescriptionSchema } from "./rich/description";
import { draftScalarFieldSchemas } from "./scalars";

/**
 * Complete decoded read response for the private draft contract §2.2.
 * Existing value validators retain their normalization semantics; no omitted
 * field is defaulted. This is not raw-byte validation, authentication, catalog
 * authorization, a fingerprint or evidence of backend endpoint availability.
 */
const requesterReadSchema = draftRequesterSchema.unwrap().extend({
  // Server-derived catalog display name: preserve it, never locally normalize.
  name: z.string().refine((value) => [...value].length <= 160, "requester name exceeds 160 codepoints").nullable(),
}).nullable();

const plainSchema = z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= 65536,
  "description_plain exceeds 65536 UTF-8 bytes",
).nullable();

const readFieldsSchema = z.object({
  ...draftScalarFieldSchemas,
  location: locationReadSchema,
  remote_scope: remoteScopeReadSchema,
  ...draftListFieldSchemas,
  requester: requesterReadSchema,
  languages: draftLanguagesSchema,
  compensation: compensationSchema,
  description: draftRichDescriptionSchema,
  description_plain: plainSchema,
}).strict().superRefine((fields, context) => {
  if ((fields.description === null) !== (fields.description_plain === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["description_plain"],
      message: "description_plain must be null if and only if description is null",
    });
  }
});

// Full-match comparison rejects the final-newline exception of JavaScript `$`.
const versionSchema = z.string().refine(
  (value) => /^[1-9][0-9]*$/.exec(value)?.[0] === value,
  "version must be a positive decimal string",
);
const timestampSchema = z.string().datetime({ precision: 6 });

/**
 * All metadata and all fields are required. Server-derived text is preserved,
 * not recalculated. Version stays a string; ETag remains a separate opaque
 * transport header and is never synthesized from these values.
 */
export const draftReadEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().uuid(),
  status: z.literal("draft"),
  principal_recruiter_id: z.string().uuid(),
  version: versionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  fields: readFieldsSchema,
}).strict();

export type DraftReadEnvelope = z.output<typeof draftReadEnvelopeSchema>;
