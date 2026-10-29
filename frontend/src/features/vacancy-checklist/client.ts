import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { lifecycleSchema } from "@/features/vacancy-lifecycle/model";
import { etagSchema } from "@/features/pipeline-movement/model";
import { checklistSchema, checklistBodySchema, marksSchema, markSchema, markBodySchema, validationFieldSchema, type Checklist, type Marks, type Mark, type Result, type FailureReason } from "./model";
export type ReadInput = { token: string; vacancyId: string };
export type SaveChecklistInput = ReadInput & { ifMatch: string; body: unknown };
export type MarkTarget = ReadInput & { participationId: string; criterionId: string };
export type SetMarkInput = MarkTarget & { body: unknown };
const uuid = z.string().uuid();
const envelopeSchema = z.object({ code: z.string(), error: z.string().optional(), fields: z.array(validationFieldSchema).optional(), data: z.object({ lifecycle: lifecycleSchema }).strict().optional() }).strict();
const fail = (reason: FailureReason, status?: number, envelope?: z.infer<typeof envelopeSchema>): Result<never> => ({ ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(envelope ? { code: envelope.code } : {}) }, ...(reason === "validation_error" && envelope?.fields ? { fields: envelope.fields } : {}) });
function failure(status?: number, envelope?: z.infer<typeof envelopeSchema>): Result<never> {
  if (status === 400 && envelope?.code !== "validation_error") return fail("invalid_request", status, envelope);
  const reasons: Record<number, FailureReason> = { 400: "validation_error", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 412: "version_conflict", 428: "precondition_required" };
  return fail(status === undefined ? "no_response" : status === 409 && envelope?.code === "process_finished" ? "process_finished" : reasons[status] ?? (status >= 500 ? "server_error" : "unrecognized_response"), status, envelope);
}
function guard(input: ReadInput | MarkTarget): Result<never> | undefined {
  if (!input.token?.trim()) return fail("unauthenticated");
  if (!uuid.safeParse(input.vacancyId).success || ("participationId" in input && (!uuid.safeParse(input.participationId).success || !uuid.safeParse(input.criterionId).success))) return fail("invalid_request");
}
async function request<T>(input: ReadInput, path: string, schema: z.ZodType<T>, write?: { body: unknown; ifMatch?: string }, withEtag = false): Promise<Result<T>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.vacancyId}/${path}`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "PUT" : "GET", headers: { authorization: `Bearer ${input.token.trim()}`, ...(write?.ifMatch ? { "if-match": write.ifMatch } : {}) },
    ...(write ? { body: write.body } : {}), expectedStatus: 200, redirect: "error", captureResponseHeaders: ["etag"], timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => envelopeSchema.parse(value),
  });
  if (!result.ok) return result.error.kind === "invalid_response" ? fail("unrecognized_response") : failure("status" in result.error ? result.error.status : undefined, result.envelope);
  if (withEtag && !etagSchema.safeParse(result.headers?.etag).success) return fail("unrecognized_response");
  return { ok: true, data: result.data, ...(withEtag ? { etag: result.headers!.etag! } : {}) };
}
export async function getChecklist(input: ReadInput): Promise<Result<Checklist>> {
  return guard(input) ?? request(input, "checklist", checklistSchema, undefined, true);
}
export async function saveChecklist(input: SaveChecklistInput): Promise<Result<Checklist>> {
  const invalid = guard(input); if (invalid) return invalid;
  if (!input.ifMatch?.trim()) return fail("precondition_required");
  if (!etagSchema.safeParse(input.ifMatch).success) return fail("invalid_request");
  const body = checklistBodySchema.safeParse(input.body); if (!body.success) return fail("validation_error");
  return request(input, "checklist", checklistSchema, { body: body.data, ifMatch: input.ifMatch }, true);
}
export async function getChecklistMarks(input: ReadInput): Promise<Result<Marks>> {
  return guard(input) ?? request(input, "checklist/marks", marksSchema);
}
const markPath = (input: MarkTarget) => `participations/${input.participationId}/checklist-marks/${input.criterionId}`;
export async function setChecklistMark(input: SetMarkInput): Promise<Result<Mark>> {
  const invalid = guard(input); if (invalid) return invalid;
  const body = markBodySchema.safeParse(input.body); if (!body.success) return fail("validation_error");
  return request(input, markPath(input), markSchema, { body: body.data });
}
/** Shared JSON transport requires a JSON success body; DELETE explicitly accepts bodyless 204 instead. */
export async function clearChecklistMark(input: MarkTarget): Promise<Result<null>> {
  const invalid = guard(input); if (invalid) return invalid;
  const { serverEnv } = await import("@/lib/env/server");
  try {
    const baseUrl = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`/v2/me/company/job-drafts/${input.vacancyId}/${markPath(input)}`, baseUrl);
    // Only the configured API origin is permitted; all interpolated segments passed UUID guards.
    if (url.origin !== baseUrl.origin || !["http:", "https:"].includes(url.protocol)) return fail("invalid_request");
    const response = await fetch(url, {
      method: "DELETE", headers: { authorization: `Bearer ${input.token.trim()}`, accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(serverEnv.apiTimeoutMs),
    });
    if (response.status === 204) return { ok: true, data: null };
    if (response.ok) return fail("unrecognized_response");
    // Bound error bodies just as the shared transport does; never expose raw server text.
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 8192) { await reader.cancel(); break; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    let envelope: z.infer<typeof envelopeSchema> | undefined;
    if (size <= 8192) try {
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const parsed = envelopeSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes))); if (parsed.success) envelope = parsed.data;
    } catch { /* Status remains authoritative when no valid envelope exists. */ }
    return failure(response.status, envelope);
  } catch { return fail("no_response"); }
}
