import { z } from "zod";

import { compensationSchema, createCompensationDefaults } from "../compensation";
import { draftListFieldSchemas } from "../lists";
import { draftNestedFieldSchemas } from "../nested";
import { draftRichDescriptionSchema } from "../rich/description";
import { draftScalarFieldSchemas } from "../scalars";
import type { LocalDraftV2Snapshot } from "../ui/draft-screening-v2-state";
import { screeningQuestionsV2Schema } from "./model";

/**
 * Private draft v2 write DTO and local-snapshot adapter
 * (`docs/contracts/private-vacancy-drafts-v2-screening.md` §1, §2, §3).
 *
 * Scope: a pure, transport-free write body. It composes the **strict complete
 * 17-field** field set exactly like the accepted v1 write body and replaces
 * only `fields.screening_questions` with the accepted v2 authoring grammar
 * (`./model.ts`), which owns the question shapes, option bounds, labels,
 * identifiers and the answer-key membership rule. Every other field, limit and
 * normalization rule is reused unchanged from the v1 validators.
 *
 * Boundaries:
 *   - This is a **design-shaped DTO**, not persistence and not proof that the
 *     backend accepts it. The backend is authoritative and must revalidate.
 *   - There is no root `schema_version`, resource version, `requester.name` or
 *     `description_plain` write input; those stay read/persisted or server
 *     derived, and the strict root and field sets reject them.
 *   - No canonicalization, JSON byte or canonical-hash claim is made here.
 *     Identity/digest decisions belong to the backend.
 *   - `POST` omission semantics are the frozen v1 defaults; `PATCH` keeps
 *     exactly its supplied keys with full replacement and never merges.
 *   - The v1 modules are imported read-only and stay unchanged, so v1 and v2
 *     write bodies cannot silently convert into each other.
 */

/**
 * Strict complete v2 field set: the accepted v1 composition with only
 * `screening_questions` replaced. The later spread is deliberately overridden
 * by the explicit v2 key so no v1 screening rule can leak in, and `.strict()`
 * rejects unknown, read-only and derived keys instead of stripping them.
 */
const completeV2FieldsSchema = z
  .object({
    ...draftScalarFieldSchemas,
    ...draftListFieldSchemas,
    ...draftNestedFieldSchemas,
    compensation: compensationSchema,
    description: draftRichDescriptionSchema,
    screening_questions: screeningQuestionsV2Schema,
  })
  .strict();

type CompleteV2Fields = z.output<typeof completeV2FieldsSchema>;

/**
 * Partial applies only to top-level presence, never to nested values: a
 * supplied object is still a complete replacement validated by its own strict
 * schema. Explicit `undefined` is not a wire value and would silently erase a
 * PATCH field, so it is rejected instead of being treated as an omission.
 */
const suppliedV2FieldsSchema = completeV2FieldsSchema.partial().superRefine((fields, context) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "explicit undefined is not a v2 draft field value",
      });
    }
  }
});

/** Apply the frozen v1 omission defaults only after every supplied value validated. */
function fillV2PostFields(fields: z.output<typeof suppliedV2FieldsSchema>): CompleteV2Fields {
  return {
    title: fields.title ?? null,
    location: fields.location ?? null,
    remote_scope: fields.remote_scope ?? null,
    work_mode: fields.work_mode ?? null,
    work_schedule: fields.work_schedule ?? null,
    contract_type: fields.contract_type ?? null,
    seniority: fields.seniority ?? null,
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

/**
 * POST body: `{ fields }` is required, an empty `fields` object creates a
 * complete fresh default value, and the root accepts no other key.
 */
export const draftV2PostBodySchema = z
  .object({
    fields: suppliedV2FieldsSchema.transform(fillV2PostFields),
  })
  .strict();

/**
 * PATCH body: at least one field is required and the output retains exactly the
 * supplied keys, each present value a full replacement with no defaults and no
 * nested merge. `empty_patch` is a validation discriminator, not an HTTP
 * response mapper.
 */
export const draftV2PatchBodySchema = z
  .object({
    fields: suppliedV2FieldsSchema.superRefine((fields, context) => {
      if (Object.keys(fields).length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "empty_patch",
          params: { kind: "empty_patch" },
        });
      }
    }),
  })
  .strict();

/** Normalized complete v2 POST body and presence-preserving v2 PATCH body. */
export type DraftV2PostBody = z.output<typeof draftV2PostBodySchema>;
export type DraftV2PatchBody = z.output<typeof draftV2PatchBodySchema>;

/**
 * The exact local v2 snapshot layout of `ui/draft-screening-v2-state.ts`: the
 * **16 non-screening** normalized fields, the validated v2 authoring questions
 * and the two derived display values. It is strict, so an unknown field key, a
 * stray v1 `screening_questions` inside `fields` or an extra root key is
 * rejected instead of being filtered away.
 */
const localDraftV2SnapshotSchema = z
  .object({
    fields: z
      .object({
        ...draftScalarFieldSchemas,
        skills: draftListFieldSchemas.skills,
        custom_benefits: draftListFieldSchemas.custom_benefits,
        benefits: draftListFieldSchemas.benefits,
        ...draftNestedFieldSchemas,
        compensation: compensationSchema,
        description: draftRichDescriptionSchema,
      })
      .strict(),
    screening_questions: screeningQuestionsV2Schema,
    requesterName: z.string().nullable(),
    descriptionPlain: z.string().nullable(),
  })
  .strict();

/**
 * Compose the 17 write fields from a **validated** snapshot. The derived
 * `requesterName` / `descriptionPlain` values are never copied into a write
 * body, and the v2 screening list is the only source of `screening_questions`.
 */
function composeV2Fields(
  snapshot: z.output<typeof localDraftV2SnapshotSchema>,
): Record<string, unknown> {
  return {
    ...snapshot.fields,
    screening_questions: snapshot.screening_questions,
  };
}

/**
 * Validate a local v2 snapshot at runtime — the parameter type is not trusted —
 * and serialize it as a complete v2 POST body of exactly 17 fields. Invalid
 * snapshots throw a `ZodError`; nothing is partially written and the input is
 * never mutated. The returned body shares no mutable structure with `snapshot`.
 */
export function draftV2SnapshotToPostBody(snapshot: LocalDraftV2Snapshot): DraftV2PostBody {
  const validated = localDraftV2SnapshotSchema.parse(snapshot);
  const body = draftV2PostBodySchema.parse({ fields: composeV2Fields(validated) });
  return { fields: structuredClone(body.fields) };
}

/**
 * Validate a local v2 snapshot and serialize it as a complete v2 PATCH body
 * (all 17 fields, each a full replacement), mirroring the accepted v1
 * full-snapshot serializer. Invalid snapshots throw a `ZodError`. The returned
 * body shares no mutable structure with `snapshot`.
 */
export function draftV2SnapshotToPatchBody(snapshot: LocalDraftV2Snapshot): DraftV2PatchBody {
  const validated = localDraftV2SnapshotSchema.parse(snapshot);
  const body = draftV2PatchBodySchema.parse({ fields: composeV2Fields(validated) });
  return { fields: structuredClone(body.fields) };
}

/**
 * Build a PATCH body from an explicit list of caller-owned changed keys, using
 * the snapshot as the value source. Only real v2 writable keys are accepted: an
 * unknown or derived key (for example `description_plain`) throws instead of
 * being silently filtered, an empty list throws the `empty_patch` rejection,
 * and each selected value is the complete replacement from the validated
 * snapshot. The returned body shares no mutable structure with `snapshot`.
 */
export function draftV2PatchBodyFromChangedKeys(
  snapshot: LocalDraftV2Snapshot,
  changedKeys: readonly string[],
): DraftV2PatchBody {
  const validated = localDraftV2SnapshotSchema.parse(snapshot);
  const allFields = composeV2Fields(validated);
  const fields: Record<string, unknown> = {};
  for (const key of changedKeys) {
    if (!Object.prototype.hasOwnProperty.call(allFields, key)) {
      throw new Error(`unknown v2 draft field key in changedKeys: ${key}`);
    }
    fields[key] = allFields[key];
  }
  const body = draftV2PatchBodySchema.parse({ fields });
  return { fields: structuredClone(body.fields) };
}
