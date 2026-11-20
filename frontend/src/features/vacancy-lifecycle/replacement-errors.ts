import { z } from "zod";
import { lifecycleSchema } from "./model";

/**
 * replacement-processes-v1 «Error codes». Every 409 below carries `data.lifecycle` (the source's, or the reopened
 * process', view) so one envelope decodes through the same path as `lifecycle_transition_invalid` / `process_finished`.
 * Pure schemas (no `server-only`): shared by the lifecycle, draft-pipeline and movement decoders.
 */
const message = z.string().min(1);
const processId = z.string().uuid();

export const REOPEN_GUARD_CODES = ["reopen_requires_replacement", "reopen_superseded", "replacement_already_active"] as const;
export const START_CONFLICT_CODES = ["replacement_source_not_closed", "replacement_source_not_latest", "replacement_already_active"] as const;

export const replacementConflictSchema = z.discriminatedUnion("code", [
  z.object({ error: message, code: z.literal("replacement_source_not_closed"), data: z.object({ lifecycle: lifecycleSchema }).strict() }).strict(),
  z.object({
    error: message, code: z.literal("replacement_source_not_latest"),
    data: z.object({ latest_process_id: processId, root_process_id: processId, lifecycle: lifecycleSchema }).strict(),
  }).strict(),
  z.object({
    error: message, code: z.literal("replacement_already_active"),
    data: z.object({ process_id: processId, root_process_id: processId, lifecycle: lifecycleSchema }).strict(),
  }).strict(),
  z.object({ error: message, code: z.literal("reopen_requires_replacement"), data: z.object({ action: z.literal("reopen"), lifecycle: lifecycleSchema }).strict() }).strict(),
  z.object({
    error: message, code: z.literal("reopen_superseded"),
    data: z.object({ successor_process_id: processId, root_process_id: processId, lifecycle: lifecycleSchema }).strict(),
  }).strict(),
]);
export type ReplacementConflict = z.infer<typeof replacementConflictSchema>;

export const replacementCreditReasonSchema = z.enum(["not_in_chain", "not_did_not_hold", "already_replaced"]);
export const carriedCandidateReasonSchema = z.enum(["not_in_chain", "currently_placed", "duplicate", "departed_hire"]);
export const carriedStageReasonSchema = z.enum(["stage_not_found", "stage_is_placement", "stage_is_exit"]);
const itemIndex = z.number().int().nonnegative();

/** 422: the per-item `reason` is what the start dialog will show next to each credit or carried candidate. */
export const replacementInvalidSchema = z.discriminatedUnion("code", [
  z.object({
    error: message, code: z.literal("replacement_credits_invalid"),
    data: z.object({ credits: z.array(z.object({ credit_id: processId, reason: replacementCreditReasonSchema }).strict()) }).strict(),
  }).strict(),
  z.object({
    error: message, code: z.literal("carried_candidate_invalid"),
    data: z.object({ candidates: z.array(z.object({ index: itemIndex, reason: carriedCandidateReasonSchema }).strict()) }).strict(),
  }).strict(),
  z.object({
    error: message, code: z.literal("carried_stage_invalid"),
    data: z.object({ candidates: z.array(z.object({ index: itemIndex, reason: carriedStageReasonSchema }).strict()) }).strict(),
  }).strict(),
]);
export type ReplacementInvalid = z.infer<typeof replacementInvalidSchema>;

export const REPLACEMENT_ERROR_CODES = [
  "replacement_source_not_closed", "replacement_source_not_latest", "replacement_already_active", "reopen_requires_replacement", "reopen_superseded",
  "replacement_credits_invalid", "carried_candidate_invalid", "carried_stage_invalid",
] as const;
export const replacementErrorEnvelopeSchema = z.union([replacementConflictSchema, replacementInvalidSchema]);
export type ReplacementErrorEnvelope = z.infer<typeof replacementErrorEnvelopeSchema>;
export const isReplacementErrorCode = (code: unknown): code is (typeof REPLACEMENT_ERROR_CODES)[number] =>
  typeof code === "string" && (REPLACEMENT_ERROR_CODES as readonly string[]).includes(code);

/** `validation_error` 400 (`WriteValidationError`): `fields[]` carries `{ field, code }`, e.g. `target_quantity` / `below_credits_count`. */
export const validationErrorEnvelopeSchema = z.object({
  error: message, code: z.literal("validation_error"),
  fields: z.array(z.object({ field: z.string().min(1), code: z.string().min(1) }).strict()).optional(),
}).strict();
export type ValidationErrorEnvelope = z.infer<typeof validationErrorEnvelopeSchema>;
