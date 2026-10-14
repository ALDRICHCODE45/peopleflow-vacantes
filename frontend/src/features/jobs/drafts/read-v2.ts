import { z } from "zod";

import { compensationSchema } from "./compensation";
import { draftListFieldSchemas } from "./lists";
import { draftLanguagesSchema, draftRequesterSchema } from "./nested";
import { draftRichDescriptionSchema } from "./rich/description";
import { draftScalarFieldSchemas } from "./scalars";
import { screeningQuestionsV2Schema } from "./screening-v2/model";

/**
 * Complete decoded v2 read response for the private draft contract
 * (`docs/contracts/private-vacancy-drafts-v2-screening.md` §1, §3, §4.4, §5, §6).
 *
 * It composes the unchanged existing validators plus the approved v2 screening
 * question model: every v1 field is preserved and only two things change —
 * `schema_version` is exactly `2` and `fields.screening_questions` uses the
 * three-variant v2 question shape. The nested `description.schema_version`
 * stays `1`, all metadata is required, no omitted field is defaulted and
 * server-derived text (`requester.name`, `description_plain`) is preserved, not
 * recalculated. The `ETag` remains a separate opaque transport header: it is
 * never part of this envelope and is never synthesized from these values.
 *
 * This is decoded-value validation only. It is not raw-byte validation,
 * duplicate-key rejection, authentication, catalog/ownership authorization, a
 * fingerprint or evidence that the v2 endpoint exists. The backend revalidates
 * and remains the authoritative privacy owner of screening data.
 */

/** Derived read-only `requester.name`: bounded, preserved verbatim, never normalized. */
const requesterReadSchema = draftRequesterSchema.unwrap().extend({
  name: z.string().refine((value) => [...value].length <= 160, "requester name exceeds 160 codepoints").nullable(),
}).nullable();

/** Derived read-only `description_plain`: ≤65536 UTF-8 bytes, preserved verbatim. */
const plainSchema = z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= 65536,
  "description_plain exceeds 65536 UTF-8 bytes",
).nullable();

/**
 * The complete 17 write fields plus the derived `description_plain`, with
 * `screening_questions` replaced by the approved v2 question model. Strict keys
 * reject unknown fields; the `description`/`description_plain` pairing keeps the
 * derived read field `null` if and only if `description` is `null`.
 */
const readFieldsSchemaV2 = z.object({
  ...draftScalarFieldSchemas,
  ...draftListFieldSchemas,
  screening_questions: screeningQuestionsV2Schema,
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
 * All metadata and all fields are required; a v1 envelope is not accepted
 * because the marker is exactly `2` and the v1 question shape fails the strict
 * v2 question model. Server-derived text is preserved, not recalculated.
 * `version` stays a positive decimal string and `ETag` stays outside.
 */
export const draftReadEnvelopeV2Schema = z.object({
  schema_version: z.literal(2),
  id: z.string().uuid(),
  status: z.literal("draft"),
  principal_recruiter_id: z.string().uuid(),
  version: versionSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  fields: readFieldsSchemaV2,
}).strict();

export type DraftReadEnvelopeV2 = z.output<typeof draftReadEnvelopeV2Schema>;
