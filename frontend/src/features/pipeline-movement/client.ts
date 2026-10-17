import "server-only";
import { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { boardSchema, detailSchema, historySchema, moveBodySchema, moveSchema, errorEnvelopeSchema, uuidSchema, etagSchema, type Board, type History, type Move, type ParticipationDetail } from "./model";
export type ReadInput = { token: string; vacancyId: string };
export type ParticipationInput = ReadInput & { participationId: string };
export type MoveInput = ParticipationInput & { etag: string; body: unknown };
export type ClientFailure = { ok: false; error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; status?: number; retryable: false }; envelope?: z.infer<typeof errorEnvelopeSchema> };
export type ClientResult<T> = { ok: true; data: T } | ClientFailure;
const invalid = (kind: "missing_token" | "invalid_request" | "invalid_response"): ClientFailure => ({ ok: false, error: { kind, retryable: false } });
function guard(input: ReadInput | ParticipationInput): ClientFailure | undefined {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (!uuidSchema.safeParse(input.vacancyId).success || ("participationId" in input && !uuidSchema.safeParse(input.participationId).success)) return invalid("invalid_request");
}
async function request<T>(input: ReadInput, path: string, schema: z.ZodType<T>, write?: { etag: string; body: z.infer<typeof moveBodySchema> }): Promise<ClientResult<T>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.vacancyId}/${path}`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "POST" : "GET", headers: { authorization: `Bearer ${input.token.trim()}`, ...(write ? { "if-match": write.etag } : {}) },
    ...(write ? { body: write.body } : {}), redirect: "error", expectedStatus: 200, captureResponseHeaders: ["etag"],
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  if (write && result.headers?.etag !== undefined && result.headers.etag !== (result.data as Move).etag) return invalid("invalid_response");
  return { ok: true, data: result.data };
}
export async function getBoard(input: ReadInput): Promise<ClientResult<Board>> {
  return guard(input) ?? request(input, "board", boardSchema);
}
export async function getParticipation(input: ParticipationInput): Promise<ClientResult<ParticipationDetail>> {
  return guard(input) ?? request(input, `participations/${input.participationId}`, detailSchema);
}
export async function getHistory(input: ParticipationInput): Promise<ClientResult<History>> {
  return guard(input) ?? request(input, `participations/${input.participationId}/history`, historySchema);
}
/** No version-derived tags and no implicit replay, even if the result is uncertain. */
export async function moveParticipation(input: MoveInput): Promise<ClientResult<Move>> {
  const failure = guard(input); if (failure) return failure;
  const body = moveBodySchema.safeParse(input.body);
  if (!body.success || !etagSchema.safeParse(input.etag).success) return invalid("invalid_request");
  return request(input, `participations/${input.participationId}/moves`, moveSchema, { etag: input.etag, body: body.data });
}
