import "server-only";

import { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { stakeholderVacanciesSchema, type StakeholderVacanciesPage } from "./model";

const envelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();

export type StakeholderVacanciesFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: z.infer<typeof envelopeSchema>;
};
export type StakeholderVacanciesResult = { ok: true; data: StakeholderVacanciesPage } | StakeholderVacanciesFailure;
export type StakeholderVacanciesQuery = { cursor?: string; limit?: number };

/**
 * `GET /v2/me/company/stakeholder/vacancies` (S12): the read-only list of the stakeholder. `limit` is 1..50 (default 20) and the
 * cursor is opaque, so it is only encoded. Nothing is requested for a bad input.
 */
export async function listStakeholderVacancies(input: StakeholderVacanciesQuery & { token: string }): Promise<StakeholderVacanciesResult> {
  if (typeof input?.token !== "string" || !input.token.trim()) return { ok: false, error: { kind: "missing_token", retryable: false } };
  if ((input.cursor !== undefined && typeof input.cursor !== "string") || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)))
    return { ok: false, error: { kind: "invalid_request", retryable: false } };
  const { serverEnv } = await import("@/lib/env/server");
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  const search = query.size > 0 ? `?${query}` : "";
  // Same absolute v2 path construction as the job-drafts list (never inherit /v1).
  const result = await requestJson(new URL(`/v2/me/company/stakeholder/vacancies${search}`, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${input.token.trim()}` },
    redirect: "error",
    expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs,
    maxErrorBodyBytes: 8192,
    decoder: value => stakeholderVacanciesSchema.parse(value),
    errorDecoder: value => envelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
