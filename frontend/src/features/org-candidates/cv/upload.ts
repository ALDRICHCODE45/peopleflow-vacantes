"use client";
import { orgCandidateDetailSchema, type OrgCandidateIdentity } from "../detail/detail-model";
import { candidateCvHref } from "../detail/detail-model";
import { cvFailure, validateCvUpload, type CvResult } from "./cv-model";

/** Browser sends binary only to the fixed same-origin bounded Route Handler. */
export async function submitOrgCandidateCv(candidate: OrgCandidateIdentity, participationId: string, etag: string, cv: File): Promise<CvResult> {
 const invalid = validateCvUpload(candidate, participationId, etag, cv); if (invalid) return invalid;
 const body = new FormData(); body.append("cv", cv);
 try {
  const response = await fetch(candidateCvHref(candidate, participationId), { method: "POST", body, headers: { "If-Match": etag }, cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60_000) });
  let value: unknown;
  try { value = await response.json(); } catch {
   return response.ok ? cvFailure(502, { code: "unrecognized_response" }) : cvFailure(response.status);
  }
  if (response.status !== 200) return cvFailure(response.status, value);
  const parsed = orgCandidateDetailSchema.safeParse(value);
  if (!parsed.success || parsed.data.id.toLowerCase() !== candidate.id.toLowerCase() || parsed.data.kind !== candidate.kind) return cvFailure(502, { code: "unrecognized_response" });
  return { ok: true, data: parsed.data };
 } catch { return cvFailure(); }
}
