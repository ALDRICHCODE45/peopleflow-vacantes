import "server-only";
import { requestJson } from "@/lib/api/server";
import { contactSchema, duplicatesSchema, errorSchema, type IntakeResult } from "./model";
import { uuidSchema } from "@/features/pipeline-movement/model";
import { intakeFailure } from "./failure";
export async function checkDuplicates(token: string, vacancyId: string, body: unknown): Promise<IntakeResult<import("zod").infer<typeof duplicatesSchema>>> {
  const parsed = contactSchema.safeParse(body);
  if (!token.trim()) return intakeFailure(401, { error: "unauthenticated", code: "unauthenticated" });
  if (!uuidSchema.safeParse(vacancyId).success || !parsed.success) return intakeFailure(400, { error: "invalid request", code: "invalid_request" });
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${vacancyId}/pipeline/candidates/manual/duplicates-check`, serverEnv.apiBaseUrl).toString(), {
    method: "POST", headers: { authorization: `Bearer ${token.trim()}` }, body: parsed.data, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 16_384, decoder: value => duplicatesSchema.parse(value), errorDecoder: value => errorSchema.parse(value),
  });
  return result.ok ? { ok: true, data: result.data } : intakeFailure("status" in result.error ? result.error.status : undefined, result.envelope);
}
