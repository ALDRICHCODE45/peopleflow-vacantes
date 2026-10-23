import { z } from "zod";
import { profileSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { candidateEditFieldSchema } from "./edit/edit-model";

const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
// The list carries only the lifecycle pair, not the board's expanded lifecycle read.
export const candidateSchema = z.object({
  kind: z.enum(["manual", "organic"]), id: uuidSchema, full_name: text,
  professional_title: z.string().nullable(), current_company: z.string().nullable(),
  profile: profileSchema, corrected_fields: z.array(candidateEditFieldSchema),
  participations: z.object({ total: count, active: count }).strict(),
  latest_participation: z.object({
    vacancy: z.object({ id: uuidSchema, title: text, lifecycle: z.object({ publication: z.enum(["published", "paused", "closed"]).nullable(), process: z.enum(["active", "finished"]).nullable() }).strict() }).strict(),
    stage: z.object({ id: uuidSchema, name: text }).strict(),
    state: z.enum(["active", "discarded"]), applied_at: timestamp,
  }).strict().nullable(),
  last_activity_at: timestamp,
}).strict();
export const listSchema = z.object({ items: z.array(candidateSchema).max(50), total: count, next_cursor: z.string().nullable() }).strict();
export const filterIssueSchema = z.object({ field: text, code: z.enum(["unknown", "invalid", "duplicate", "required", "not_found"]) }).strict();
export const errorEnvelopeSchema = z.union([
  z.object({ error: text, code: z.literal("invalid_filter"), fields: z.array(filterIssueSchema).min(1) }).strict(),
  z.object({ error: text, code: text.refine(code => code !== "invalid_filter") }).strict(),
]);
export type OrgCandidate = z.infer<typeof candidateSchema>;
export type CandidatePage = z.infer<typeof listSchema>;
export type FilterIssue = z.infer<typeof filterIssueSchema>;
export type CandidateFailure = { ok: false; reason: "unauthenticated" | "forbidden" | "invalid_filter" | "invalid_cursor" | "server_error" | "no_response" | "unrecognized_response"; fields?: FilterIssue[]; reference: { status?: number; code?: string } };
export type CandidateResult = { ok: true; data: CandidatePage } | CandidateFailure;
