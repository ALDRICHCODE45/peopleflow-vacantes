import { z } from "zod";
import { deliverySummarySchema } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { validateDiscardText } from "./discard-text";
export const discardReasonSchema = z.discriminatedUnion("group", [
  z.object({ group: z.literal("recruiter"), key: z.enum(["requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "other"]) }).strict(),
  z.object({ group: z.literal("candidate"), key: z.enum(["accepted_other_offer", "no_longer_interested", "unresponsive", "other"]) }).strict(),
]);
const discardTextSchema = (limit: number) => z.string().transform(value => validateDiscardText(value, limit, true)).refine(result => !result.error).transform(result => result.value);
export const discardBodySchema = z.object({ reason: discardReasonSchema, comment: discardTextSchema(1000).optional(), candidate_message: discardTextSchema(500).optional(), confirm_placement_exit: z.boolean().optional() }).strict().refine(body => body.reason.key !== "other" || !!body.comment);
export const recoverBodySchema = z.object({ confirm_placement_reentry: z.boolean().optional() }).strict();
export type DiscardReason = z.infer<typeof discardReasonSchema>;
export type DiscardBody = z.infer<typeof discardBodySchema>;
export type RecoverBody = z.infer<typeof recoverBodySchema>;
export const uuidSchema = z.string().uuid();
const text = z.string().refine(value => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
export const etagSchema = z.string().regex(/^"[\x21\x23-\x7e\x80-\xff]+"$(?![\s\S])/);
export const stageKindSchema = z.enum(["new", "screening", "screening_ok", "in_process", "placement", "custom"]);
const discardSchema = z.object({ reason: discardReasonSchema, discarded_at: timestamp, previous_stage_id: uuidSchema }).strict();
export const participationSchema = z.object({
  id: uuidSchema, stage_id: uuidSchema, version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/), etag: etagSchema,
  candidate: z.object({ id: uuidSchema, full_name: text }).strict(), applied_at: timestamp, source: z.literal("organic"),
  cv: z.object({ id: uuidSchema, name: text }).strict(), moved_at: timestamp, discard: discardSchema.nullable(), substate_id: uuidSchema.nullable(),
}).strict();
export const coverageSchema = z.object({ covered: count, required: z.number().int().positive().safe().nullable(), full_coverage_reached_at: timestamp.nullable() }).strict();
export const boardSchema = z.object({
  stages: z.array(z.object({ id: uuidSchema, kind: stageKindSchema, name: text, count }).strict()),
  exit: z.object({ id: uuidSchema, kind: z.literal("discarded"), name: text, count }).strict(),
  substates: z.array(z.object({ id: uuidSchema, name: text }).strict()),
  delivery: deliverySummarySchema, coverage: coverageSchema, participations: z.array(participationSchema).max(1000),
}).strict().refine(board => board.participations.every(item => item.discard === null
  ? item.stage_id !== board.exit.id
  : item.stage_id === board.exit.id && Date.parse(item.moved_at) === Date.parse(item.discard.discarded_at)
    && board.stages.some(stage => stage.id === item.discard!.previous_stage_id)))
  .refine(board => board.participations.every(item => item.substate_id === null ||
    (board.stages.some(stage => stage.id === item.stage_id && stage.kind === "in_process") && board.substates.some(substate => substate.id === item.substate_id))));
export const substateBodySchema = z.object({ substate_id: uuidSchema.nullable() }).strict();
export const moveBodySchema = z.object({ to_stage_id: uuidSchema, confirm_placement_exit: z.boolean().optional() }).strict();
export const moveSchema = participationSchema.extend({ coverage: coverageSchema, delivery: deliverySummarySchema }).strict();
const screeningAnswer = z.discriminatedUnion("type", [
  z.object({ question_id: uuidSchema, prompt: text, type: z.literal("open"), answer: z.object({ text }).strict() }).strict(),
  z.object({ question_id: uuidSchema, prompt: text, type: z.literal("single_choice"), answer: z.object({ option_id: uuidSchema, label: text }).strict() }).strict(),
]);
export const detailSchema = participationSchema.extend({ screening: z.array(screeningAnswer), comment: discardTextSchema(1000).nullable(), candidate_message: discardTextSchema(500).nullable() }).strict().refine(item => item.discard !== null || (item.comment === null && item.candidate_message === null));
const historyBase = {
  from_stage_id: uuidSchema.nullable(), to_stage_id: uuidSchema, hire: z.boolean(), departure: z.boolean(),
  actor: z.object({ kind: z.enum(["candidate", "recruiter"]), id: uuidSchema, full_name: text }).strict(), at: timestamp,
};
export const historySchema = z.object({ items: z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("substate"), from_substate_id: uuidSchema.nullable(), from_substate_name: text.nullable(), to_substate_id: uuidSchema.nullable(), to_substate_name: text.nullable(), actor: historyBase.actor, at: timestamp }).strict(),
  z.object({ ...historyBase, kind: z.literal("intake") }).strict(),
  z.object({ ...historyBase, kind: z.literal("move") }).strict(),
  z.object({ ...historyBase, kind: z.literal("discard"), from_stage_id: uuidSchema, hire: z.literal(false), reason: discardReasonSchema, comment: discardTextSchema(1000).nullable(), candidate_message: discardTextSchema(500).nullable() }).strict(),
  z.object({ ...historyBase, kind: z.literal("recovery"), from_stage_id: uuidSchema, departure: z.literal(false) }).strict(),
])) }).strict().refine(history => history.items.every(entry => entry.kind !== "substate" ||
  ((entry.from_substate_id === null) === (entry.from_substate_name === null) && (entry.to_substate_id === null) === (entry.to_substate_name === null))));
export const errorEnvelopeSchema = z.object({ error: text, code: text }).strict();
export type Board = z.infer<typeof boardSchema>;
export type Participation = z.infer<typeof participationSchema>;
export type MoveBody = z.infer<typeof moveBodySchema>;
export type Move = z.infer<typeof moveSchema>;
export type ParticipationDetail = z.infer<typeof detailSchema>;
export type History = z.infer<typeof historySchema>;
export type Result<T> = { ok: true; data: T } | Failure;
export type FailureReason = "unauthenticated" | "forbidden" | "company_inactive" | "company_not_active" | "board_too_large" |
  "vacancy_not_published" | "not_found" | "stage_skip_not_allowed" | "placement_exit_confirmation_required" | "validation_error" |
  "substate_requires_in_process" | "already_discarded" | "not_discarded" | "placement_reentry_confirmation_required" | "invalid_request" | "version_conflict" | "precondition_required" | "cv_storage_unavailable" | "no_response" | "uncertain" | "unrecognized_response" | "server_error";
export type Failure = { ok: false; reason: FailureReason; reference: { status?: number; code?: string } };
