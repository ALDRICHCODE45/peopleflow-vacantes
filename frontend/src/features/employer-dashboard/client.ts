import "server-only";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { dashboardSchema, errorEnvelopeSchema, type Dashboard } from "./model";
import type { z } from "zod";

export type DashboardClientFailure = { ok: false; error: { kind: RequestJsonError["kind"] | "missing_token"; retryable: boolean; status?: number }; envelope?: z.infer<typeof errorEnvelopeSchema> };
export async function getDashboard(input: { token: string }): Promise<{ ok: true; data: Dashboard } | DashboardClientFailure> {
  if (typeof input.token !== "string" || !input.token.trim()) return { ok: false, error: { kind: "missing_token", retryable: false } };
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL("/v2/me/company/dashboard", serverEnv.apiBaseUrl).toString(), {
    method: "GET", headers: { authorization: `Bearer ${input.token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => dashboardSchema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
