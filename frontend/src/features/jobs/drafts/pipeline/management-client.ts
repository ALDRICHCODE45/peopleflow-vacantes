import "server-only";

import { z } from "zod";
import { isValidJobId } from "@/features/jobs/jobId";
import { requestJson } from "@/lib/api/server";
import type { PublicationFailure } from "./publication-client";
import { publicationErrorEnvelopeSchema } from "./failure";
import { isCivilDate } from "./delivery-model";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$(?![\s\S])/).refine(isCivilDate);
const fields = { requestDate: date.nullable(), hiringHeadcount: z.number().int().nullable() };
const managementSchema = z.object({
  version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/), ...fields,
  limits: z.object({ maxHiringHeadcount: z.number().int().positive() }).strict(), today: date,
}).strict();
const putBodySchema = z.object(fields).strict();

export type DraftManagement = z.infer<typeof managementSchema>;
export type DraftManagementResult = { ok: true; data: DraftManagement; etag: string } | PublicationFailure;
type ReadInput = { token: string; draftId: string };
export type SaveDraftManagementInput = ReadInput & { ifMatch: string; body: unknown };
function invalid(kind: "missing_token" | "invalid_request" | "invalid_response"): PublicationFailure {
  return { ok: false, error: { kind, retryable: false } };
}
function guard(input: ReadInput): PublicationFailure | undefined {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (typeof input.draftId !== "string" || input.draftId.length !== 36 || !isValidJobId(input.draftId)) return invalid("invalid_request");
}
async function requestManagement(input: ReadInput, write?: { ifMatch: string; body: z.infer<typeof putBodySchema> }): Promise<DraftManagementResult> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.draftId}/management`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "PUT" : "GET",
    headers: { authorization: `Bearer ${input.token.trim()}`, ...(write ? { "if-match": write.ifMatch } : {}) },
    ...(write ? { body: write.body } : {}),
    redirect: "error", expectedStatus: 200, captureResponseHeaders: ["etag"], timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => managementSchema.parse(value), errorDecoder: value => publicationErrorEnvelopeSchema.parse(value),
  });
  // An uncertain write is reconciled with GET, never replayed automatically.
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  const etag = result.headers?.etag;
  if (etag === undefined || !etag.trim()) return invalid("invalid_response");
  return { ok: true, data: result.data, etag };
}
export async function getDraftManagement(input: ReadInput): Promise<DraftManagementResult> { return guard(input) ?? requestManagement(input); }
export async function saveDraftManagement(input: SaveDraftManagementInput): Promise<DraftManagementResult> {
  const failure = guard(input);
  if (failure) return failure;
  if (typeof input.ifMatch !== "string" || !input.ifMatch.trim()) return invalid("invalid_request");
  const body = putBodySchema.safeParse(input.body);
  if (!body.success) return invalid("invalid_request");
  return requestManagement(input, { ifMatch: input.ifMatch, body: body.data });
}
