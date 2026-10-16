import "server-only";

import { z } from "zod";
import { isValidJobId } from "@/features/jobs/jobId";
import { requestJson } from "@/lib/api/server";
import type { DraftPipelineFailure } from "./client";
import { publicationErrorEnvelopeSchema } from "./failure";

const uuid = z.string().length(36).refine(isValidJobId);
const timestamp = z.string().datetime({ offset: true });
const missing = z.array(z.string().refine(value => value.trim().length > 0));
const readinessSchema = z.object({ status: z.enum(["draft", "published"]), publishedAt: timestamp.nullable(), missing }).strict();
const publishedSchema = z.object({ id: uuid, status: z.literal("published"), publishedAt: timestamp }).strict();
export type DraftPublication = z.infer<typeof readinessSchema>;
export type PublishedDraft = z.infer<typeof publishedSchema>;
export type PublicationFailure = Omit<DraftPipelineFailure, "envelope"> & { envelope?: z.infer<typeof publicationErrorEnvelopeSchema> };
export type DraftPublicationResult = { ok: true; data: DraftPublication } | PublicationFailure;
export type PublishDraftResult = { ok: true; data: PublishedDraft; idempotencyReplayed: "true" | "false" } | PublicationFailure;
type ReadInput = { token: string; draftId: string };
export type PublishDraftInput = ReadInput & { ifMatch: string; idempotencyKey: string; body: unknown };
function invalid(kind: "missing_token" | "invalid_request" | "invalid_response"): PublicationFailure { return { ok: false, error: { kind, retryable: false } }; }
function guard(input: ReadInput) {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (!uuid.safeParse(input.draftId).success) return invalid("invalid_request");
}
async function requestPublication<T>(input: ReadInput, decoder: (value: unknown) => T, write?: PublishDraftInput) {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.draftId}/publication`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "POST" : "GET", redirect: "error", expectedStatus: write ? 201 : 200,
    headers: { authorization: `Bearer ${input.token.trim()}`, ...(write ? { "if-match": write.ifMatch, "idempotency-key": write.idempotencyKey } : {}) },
    ...(write ? { body: {} } : {}), captureResponseHeaders: ["idempotency-replayed"],
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, decoder, errorDecoder: value => publicationErrorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false as const } };
}
export async function getDraftPublication(input: ReadInput): Promise<DraftPublicationResult> {
  const failure = guard(input); if (failure) return failure;
  const result = await requestPublication(input, value => readinessSchema.parse(value));
  return result.ok ? { ok: true, data: result.data } : result;
}
/** Caller owns the key and draft ETag. Replay precedes preconditions on the server; publication never changes that ETag. */
export async function publishDraft(input: PublishDraftInput): Promise<PublishDraftResult> {
  const failure = guard(input); if (failure) return failure;
  if (!uuid.safeParse(input.idempotencyKey).success || typeof input.ifMatch !== "string" || !input.ifMatch.trim() || !z.object({}).strict().safeParse(input.body).success) return invalid("invalid_request");
  const result = await requestPublication(input, value => {
    const data = publishedSchema.parse(value);
    if (data.id.toLowerCase() !== input.draftId.toLowerCase()) throw new Error("Mismatched publication identity");
    return data;
  }, input);
  if (!result.ok) return result;
  const replay = result.headers?.["idempotency-replayed"];
  if (replay !== "true" && replay !== "false") return invalid("invalid_response");
  return { ok: true, data: result.data, idempotencyReplayed: replay };
}
