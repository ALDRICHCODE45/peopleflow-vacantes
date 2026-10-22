import "server-only";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { orgCandidateDetailSchema, type OrgCandidateIdentity } from "../detail/detail-model";
import { cvFailure, validateCvUpload, type CvResult } from "./cv-model";

/** Multipart adapter: same authority, redirect, timeout and cache guards as intake's file client. */
export async function uploadOrgCandidateCv(token: string, candidate: OrgCandidateIdentity, participationId: string, etag: string, cv: File, signal?: AbortSignal): Promise<CvResult> {
 if (!token?.trim()) return cvFailure(401, { code: "unauthenticated" });
 const invalid = validateCvUpload(candidate, participationId, etag, cv); if (invalid) return invalid;
 try {
  const { serverEnv } = await import("@/lib/env/server");
  const base = new URL(serverEnv.apiBaseUrl);
  const endpoint = new URL(`/v2/me/company/candidates/${candidate.kind}/${candidate.id}/participations/${participationId}/cv`, base);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.origin !== base.origin || endpoint.username || endpoint.password) return cvFailure(400, { code: "invalid_request" });
  const abort = AbortSignal.any([AbortSignal.timeout(serverEnv.apiTimeoutMs), ...(signal ? [signal] : [])]);
  const body = new FormData();
  body.append("cv", cv, cv.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "") || "cv");
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token.trim()}`, "If-Match": etag }, body, cache: "no-store", redirect: "error", signal: abort });
  if (response.status !== 200 && (response.status < 400 || response.status > 599)) {
   void response.body?.cancel().catch(() => {});
   return cvFailure(502, { code: "unrecognized_response" });
  }
  let value: unknown;
  try { value = await boundedJson(response, response.status === 200 ? 1_048_576 : 8192, abort); }
  catch { return cvFailure(response.ok ? 502 : response.status); }
  if (response.status !== 200) return cvFailure(response.status, value);
  const parsed = orgCandidateDetailSchema.safeParse(value);
  const header = response.headers.get("etag");
  if (!parsed.success || parsed.data.kind !== candidate.kind || parsed.data.id.toLowerCase() !== candidate.id.toLowerCase() || !parsed.data.participations.some(item => item.id.toLowerCase() === participationId.toLowerCase()) || (header && header !== parsed.data.etag)) return cvFailure(502, { code: "unrecognized_response" });
  return { ok: true, data: parsed.data };
 } catch { return cvFailure(); }
}
