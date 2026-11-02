import { z } from "zod";
import { publicJobItemSchema } from "@/features/jobs/schemas";

export const jobIdSchema = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
export const savedJobSchema = z.object({ job_id: jobIdSchema, saved_at: timestamp }).strict();
const snapshotKeys = { source: true, title: true, company: true, location_label: true, work_mode: true,
  compensation: true, legacy_salary: true, published_at: true } as const;
// Reuse the catalog decoders: the saved snapshot has exactly the same C1 values,
// including the legacy-only salary shape, without catalog-only fields.
const [legacy, vacancy] = publicJobItemSchema.innerType().options;
export const savedJobSnapshotSchema = z.discriminatedUnion("source", [legacy.pick(snapshotKeys), vacancy.pick(snapshotKeys)]);
export const savedJobItemSchema = savedJobSchema.extend({
  availability: z.enum(["open", "closed"]), closed_at: timestamp.nullable(),
  application: z.object({ id: jobIdSchema, applied_at: timestamp }).strict().nullable(),
  job: savedJobSnapshotSchema,
}).strict().refine(row => row.job.source !== "legacy" || row.application === null, { path: ["application"] })
  .refine(row => row.availability !== "open" || row.closed_at === null, { path: ["closed_at"] });
export const savedJobsSchema = z.object({ items: z.array(savedJobItemSchema).max(200), total: z.number().int().min(0).max(200), limit: z.literal(200) }).strict()
  .refine(value => value.total === value.items.length);
export const savedJobIdsSchema = z.object({ job_ids: z.array(jobIdSchema).max(200).refine(ids => new Set(ids).size === ids.length) }).strict();
export const removedJobsSchema = z.object({ removed: z.number().int().min(0).max(200) }).strict();
export const savedJobsErrorSchema = z.discriminatedUnion("code", [
  z.object({ error: z.string(), code: z.literal("not_found") }).strict(),
  z.object({ error: z.literal("job unavailable"), code: z.literal("job_unavailable") }).strict(),
  z.object({ error: z.literal("saved jobs limit reached"), code: z.literal("saved_jobs_limit"), data: z.object({ limit: z.literal(200) }).strict() }).strict(),
  z.object({ error: z.literal("validation failed"), code: z.literal("validation_error"), fields: z.array(z.object({ field: z.string(), code: z.string() }).strict()) }).strict(),
  z.object({ error: z.string(), code: z.literal("unauthenticated") }).strict(),
  z.object({ error: z.string(), code: z.literal("forbidden") }).strict(),
  z.object({ error: z.string(), code: z.literal("wrong_role") }).strict(),
]);
export type SavedJob = z.infer<typeof savedJobSchema>;
export type SavedJobs = z.infer<typeof savedJobsSchema>;
export type SavedJobItem = z.infer<typeof savedJobItemSchema>;
export type SavedJobIds = z.infer<typeof savedJobIdsSchema>;
export type SavedJobsReason = "not_found" | "job_unavailable" | "saved_jobs_limit" | "validation_error" | "unauthenticated" | "forbidden" | "server_error" | "no_response" | "unrecognized_response";
export type SavedJobsFailure = { ok: false; reason: SavedJobsReason; reference: { status?: number; code?: string }; limit?: number };
export type SavedJobsResult<T> = { ok: true; data: T } | SavedJobsFailure;
