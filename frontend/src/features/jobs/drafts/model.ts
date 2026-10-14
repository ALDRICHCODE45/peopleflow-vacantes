import {
  draftPatchBodySchema,
  draftPostBodySchema,
  type DraftPatchBody,
  type DraftPostBody,
} from "./fields";
import { draftReadEnvelopeSchema } from "./read";

/**
 * Complete 17-field private-vacancy-draft model (T3f).
 *
 * This is a pure, transport-free value: a validated full snapshot of the
 * writable draft plus the derived display text that belongs to the fetched
 * snapshot. It is deliberately separate from the legacy vacancy form and its
 * conversions, and it adds no HTTP, storage, UI, BFF or backend behavior.
 *
 * It reuses only the accepted public schemas/read-only:
 *   - `draftReadEnvelopeSchema` validates the complete read envelope (§2.2);
 *   - `draftPostBodySchema` / `draftPatchBodySchema` validate and normalize the
 *     17-field write body (§2.1, §4–§5) and remain the single source of truth
 *     for field rules, because `completeFieldsSchema` is intentionally private.
 *
 * Boundaries of this unit:
 *   - `fields` is the complete `DraftPostBody["fields"]` snapshot;
 *   - `requesterName` and `descriptionPlain` are server-derived display values
 *     of that same fetched snapshot. They are **never** recomputed from local
 *     edits and are **never** written into a POST/PATCH body. They describe the
 *     snapshot the caller fetched, not the current editor state;
 *   - metadata (`id`, `version`, `ETag`, timestamps, idempotency keys) stays
 *     caller-owned: no tag is generated, parsed or diffed here;
 *   - serialization is always a **full 17-field snapshot**. There is no diff,
 *     no no-op detection and no partial model: a runtime-malformed model is
 *     refused instead of being silently filled with POST defaults;
 *   - every returned/model structure is detached (`structuredClone`) in both
 *     directions, so the caller may mutate any of them freely.
 */

/** The complete writable field set of a private draft POST body. */
type DraftWriteFields = DraftPostBody["fields"];

/**
 * The 17 contract writable `fields` keys, in the accepted schema order. Typed
 * against `DraftPostBody["fields"]` so a stale key cannot compile.
 */
const WRITABLE_FIELD_KEYS = [
  "title",
  "location",
  "work_mode",
  "work_schedule",
  "contract_type",
  "seniority",
  "professional_area",
  "required_requirements",
  "preferred_requirements",
  "skills",
  "custom_benefits",
  "benefits",
  "screening_questions",
  "requester",
  "languages",
  "compensation",
  "description",
] as const satisfies readonly (keyof DraftWriteFields)[];

/**
 * The complete draft model: the full writable snapshot plus the derived display
 * values of the fetched snapshot.
 */
export type DraftModel = {
  fields: DraftWriteFields;
  /** Server-derived requester catalog name; read-only display, never written. */
  requesterName: string | null;
  /** Server-derived plain description; read-only display, never written. */
  descriptionPlain: string | null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Require an already-present complete 17-field object before any accepted
 * schema runs. Presence is checked first because the accepted POST schema
 * documents POST omission defaults: delegating a partial runtime object to it
 * would silently fill the missing fields and hide the malformed model. Value
 * validation and normalization stay in the accepted schemas.
 */
function requireAllWritableFields(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("draft model fields must be a complete writable fields object");
  }
  if (Object.keys(value).length !== WRITABLE_FIELD_KEYS.length) {
    throw new Error("draft model fields must contain exactly the 17 writable draft fields");
  }
  for (const key of WRITABLE_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      throw new Error(`draft model is missing the required writable field: ${key}`);
    }
  }
  return value;
}

/**
 * Build a fresh empty draft model from the accepted omitted-POST defaults.
 * Every call owns new lists, a new `compensation` object and its own derived
 * display values, so no two models share mutable state.
 */
export function createDraftModel(): DraftModel {
  const fields = draftPostBodySchema.parse({ fields: {} }).fields;
  return { fields, requesterName: null, descriptionPlain: null };
}

/**
 * Validate a complete read envelope (§2.2) and project its writable snapshot:
 * exactly the 17 write fields, with `description_plain` and the read-only
 * `requester.name` removed from `fields`. The derived values are kept beside
 * the fields, verbatim, as display state for the fetched snapshot.
 *
 * The returned model is a detached clone: it shares no mutable structure with
 * `input`, and `input` is never mutated. Invalid envelopes throw a Zod error
 * rather than returning a partial model.
 */
export function hydrateDraftModel(input: unknown): DraftModel {
  const envelope = draftReadEnvelopeSchema.parse(input);
  const { description_plain, requester, ...writableFields } = envelope.fields;
  const projectedFields = requireAllWritableFields({
    ...writableFields,
    requester: requester === null ? null : { kind: requester.kind, id: requester.id },
  });
  const fields = draftPostBodySchema.parse({ fields: projectedFields }).fields;
  return {
    fields: structuredClone(fields),
    requesterName: requester === null ? null : requester.name,
    descriptionPlain: description_plain,
  };
}

/**
 * Serialize the full 17-field snapshot as a POST body through the accepted
 * write schema. Every field is required: a model missing a key, carrying
 * `undefined` or an unknown key is refused before any default could apply.
 * The returned body shares no mutable structure with `model`.
 */
export function draftModelToPostBody(model: DraftModel): DraftPostBody {
  const fields = draftPostBodySchema.parse({
    fields: requireAllWritableFields(model?.fields),
  }).fields;
  return { fields: structuredClone(fields) };
}

/**
 * Serialize the full 17-field snapshot as a PATCH body through the accepted
 * write schema. A full snapshot means all 17 fields are present and each one is
 * a complete replacement; partial models are refused instead of being filled
 * with defaults. The returned body shares no mutable structure with `model`.
 */
export function draftModelToPatchBody(model: DraftModel): DraftPatchBody {
  const fields = draftPatchBodySchema.parse({
    fields: requireAllWritableFields(model?.fields),
  }).fields;
  return { fields: structuredClone(fields) };
}
