import { z } from "zod";
export const uuidSchema = z.string().uuid();
const text = z.string().refine(value => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
export const etagSchema = z.string().regex(/^"[\x21\x23-\x7e\x80-\xff]+"$(?![\s\S])/);
export const stageKindSchema = z.enum(["new", "screening", "screening_ok", "in_process", "placement", "custom"]);
export const participationSchema = z.object({
  id: uuidSchema, stage_id: uuidSchema, version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/), etag: etagSchema,
  candidate: z.object({ id: uuidSchema, full_name: text }).strict(), applied_at: timestamp, source: z.literal("organic"),
  cv: z.object({ id: uuidSchema, name: text }).strict(), moved_at: timestamp,
}).strict();
export const coverageSchema = z.object({ covered: count, required: z.number().int().positive().safe().nullable(), full_coverage_reached_at: timestamp.nullable() }).strict();
export const boardSchema = z.object({
  stages: z.array(z.object({ id: uuidSchema, kind: stageKindSchema, name: text, count }).strict()),
  exit: z.object({ id: uuidSchema, kind: z.literal("discarded"), name: text, count }).strict(),
  coverage: coverageSchema, participations: z.array(participationSchema).max(1000),
}).strict();
export const moveBodySchema = z.object({ to_stage_id: uuidSchema, confirm_placement_exit: z.boolean().optional() }).strict();
export const moveSchema = participationSchema.extend({ coverage: coverageSchema }).strict();
const screeningAnswer = z.discriminatedUnion("type", [
  z.object({ question_id: uuidSchema, prompt: text, type: z.literal("open"), answer: z.object({ text }).strict() }).strict(),
  z.object({ question_id: uuidSchema, prompt: text, type: z.literal("single_choice"), answer: z.object({ option_id: uuidSchema, label: text }).strict() }).strict(),
]);
export const detailSchema = participationSchema.extend({ screening: z.array(screeningAnswer) }).strict();
export const historySchema = z.object({ items: z.array(z.object({
  kind: z.enum(["intake", "move"]), from_stage_id: uuidSchema.nullable(), to_stage_id: uuidSchema, hire: z.boolean(), departure: z.boolean(),
  actor: z.object({ kind: z.enum(["candidate", "recruiter"]), id: uuidSchema, full_name: text }).strict(), at: timestamp,
}).strict()) }).strict();
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
  "invalid_request" | "version_conflict" | "precondition_required" | "cv_storage_unavailable" | "no_response" | "uncertain" | "unrecognized_response" | "server_error";
export type Failure = { ok: false; reason: FailureReason; reference: { status?: number; code?: string } };
