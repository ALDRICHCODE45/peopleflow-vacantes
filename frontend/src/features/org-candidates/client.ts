import "server-only";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { listSchema, errorEnvelopeSchema, type CandidatePage } from "./model";
import { z } from "zod";
import { serializeFilters, type CandidateQuery } from "./url-state";
export type ListCandidatesFailure = { ok: false; error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number }; envelope?: z.infer<typeof errorEnvelopeSchema> };
export async function listCandidates(input: CandidateQuery & { token: string }): Promise<{ ok: true; data: CandidatePage } | ListCandidatesFailure> {
  if (typeof input.token !== "string" || !input.token.trim()) return { ok: false, error: { kind: "missing_token", retryable: false } };
  if ((input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)) || (input.cursor !== undefined && typeof input.cursor !== "string")) return { ok: false, error: { kind: "invalid_request", retryable: false } };
  const { serverEnv } = await import("@/lib/env/server");
  const params = serializeFilters(input.filters ?? {});
  params.set("limit", String(input.limit ?? 20));
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  const result = await requestJson(new URL(`/v2/me/company/candidates?${params}`, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${input.token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => listSchema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
