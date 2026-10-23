import "server-only";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { errorEnvelopeSchema } from "../model";
import { candidatesSummarySchema, type CandidatesSummary } from "./summary-model";
import type { z } from "zod";

export type SummaryClientFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token"; retryable: boolean; status?: number };
  envelope?: z.infer<typeof errorEnvelopeSchema>;
};

export async function getCandidatesSummary(input: { token: string }): Promise<{ ok: true; data: CandidatesSummary } | SummaryClientFailure> {
  if (typeof input.token !== "string" || !input.token.trim()) {
    return { ok: false, error: { kind: "missing_token", retryable: false } };
  }
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL("/v2/me/company/candidates/summary", serverEnv.apiBaseUrl).toString(), {
    method: "GET",
    headers: { authorization: `Bearer ${input.token.trim()}` },
    redirect: "error",
    expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs,
    maxErrorBodyBytes: 8192,
    decoder: value => candidatesSummarySchema.parse(value),
    errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  // Like the list, this read retries only after an explicit user request.
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
