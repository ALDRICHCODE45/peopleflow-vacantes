"use client";
import { intakeResponseSchema, type IntakeBody, type IntakeResponse, type IntakeResult } from "./model";
import { intakeFailure } from "./failure";
export async function submitManualCandidate(vacancyId: string, data: IntakeBody, cv: File, key: string): Promise<IntakeResult<IntakeResponse>> {
  const body = new FormData(); body.append("data", JSON.stringify(data)); body.append("cv", cv);
  try {
    const response = await fetch(`/api/company/manual-candidates/${encodeURIComponent(vacancyId)}`, { method: "POST", body, headers: { "Idempotency-Key": key }, cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60_000) });
    let value: unknown;
    try { value = await response.json(); } catch { return intakeFailure(502); }
    if (response.status !== 201) return intakeFailure(response.status, value);
    const parsed = intakeResponseSchema.safeParse(value);
    return parsed.success ? { ok: true, data: parsed.data } : intakeFailure(502);
  } catch { return intakeFailure(); }
}
