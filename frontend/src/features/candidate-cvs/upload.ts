"use client";
import { cvSchema, errorEnvelopeSchema, type Cv, type CvLimits, type CvResult } from "./model";
import { cvFailure } from "./failure";
/** Only this fixed same-origin Route Handler receives browser files; credentials stay server-side. */
export async function uploadCv(file: File, limits: CvLimits): Promise<CvResult<Cv>> {
  const body = new FormData(); body.append("file", file);
  try {
    const response = await fetch("/api/candidate/cvs", { method: "POST", body, cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (response.status !== 201) {
      let envelope;
      try { envelope = errorEnvelopeSchema.parse(await response.json()); } catch { /* Never display raw route responses. */ }
      if ((response.status === 503 && envelope?.code === "no_response") || (response.status === 502 && envelope?.code === "unrecognized_response")) {
        return { ok: false, reason: envelope.code, reference: { status: response.status, code: envelope.code } };
      }
      return cvFailure({ ok: false, error: { kind: response.ok ? "invalid_response" : "status", ...(response.ok ? {} : { status: response.status }) }, envelope });
    }
    try {
      const data = cvSchema.parse(await response.json());
      if (!limits.content_types.includes(data.content_type) || data.size > limits.max_bytes) throw new Error("Invalid CV");
      return { ok: true, data };
    } catch { return { ok: false, reason: "unrecognized_response", reference: {} }; }
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
