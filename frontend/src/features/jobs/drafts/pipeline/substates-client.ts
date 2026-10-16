import "server-only";

import { z } from "zod";
import { isValidJobId } from "@/features/jobs/jobId";
import { requestJson } from "@/lib/api/server";
import type { DraftPipelineFailure } from "./client";

const uuid = z.string().length(36).refine(isValidJobId);
const catalogSchema = z.object({
  version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/),
  substates: z.array(z.object({ id: uuid, name: z.string() }).strict()),
  limits: z.object({ maxSubstates: z.number().int().positive(), nameMaxLength: z.number().int().positive() }).strict(),
  suggestions: z.array(z.string()),
}).strict();
const putBodySchema = z.object({ substates: z.array(z.object({ id: uuid.optional(), name: z.string() }).strict()) }).strict();
const envelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();
export type DraftSubstates = z.infer<typeof catalogSchema>;
export type DraftSubstatesResult = { ok: true; data: DraftSubstates; etag: string } | DraftPipelineFailure;
type ReadInput = { token: string; draftId: string };
export type SaveDraftSubstatesInput = ReadInput & { ifMatch: string; body: unknown };
function invalid(kind: "missing_token" | "invalid_request" | "invalid_response"): DraftPipelineFailure {
  return { ok: false, error: { kind, retryable: false } };
}
function guard(input: ReadInput): DraftPipelineFailure | undefined {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (typeof input.draftId !== "string" || input.draftId.length !== 36 || !isValidJobId(input.draftId)) return invalid("invalid_request");
}
async function requestSubstates(input: ReadInput, write?: { ifMatch: string; body: z.infer<typeof putBodySchema> }): Promise<DraftSubstatesResult> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.draftId}/pipeline/substates`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "PUT" : "GET",
    headers: { authorization: `Bearer ${input.token.trim()}`, ...(write ? { "if-match": write.ifMatch } : {}) },
    ...(write ? { body: write.body } : {}),
    redirect: "error", expectedStatus: 200, captureResponseHeaders: ["etag"], timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => catalogSchema.parse(value), errorDecoder: value => envelopeSchema.parse(value),
  });
  // Writes are never retried. The editor reconciles uncertain outcomes with GET.
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  const etag = result.headers?.etag;
  if (etag === undefined || !etag.trim()) return invalid("invalid_response");
  return { ok: true, data: result.data, etag };
}
export async function getDraftSubstates(input: ReadInput): Promise<DraftSubstatesResult> {
  return guard(input) ?? requestSubstates(input);
}
export async function saveDraftSubstates(input: SaveDraftSubstatesInput): Promise<DraftSubstatesResult> {
  const failure = guard(input);
  if (failure) return failure;
  if (typeof input.ifMatch !== "string" || !input.ifMatch.trim()) return invalid("invalid_request");
  const body = putBodySchema.safeParse(input.body);
  if (!body.success) return invalid("invalid_request");
  return requestSubstates(input, { ifMatch: input.ifMatch, body: body.data });
}
