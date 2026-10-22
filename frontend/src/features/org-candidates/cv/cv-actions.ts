"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import type { OrgCandidateIdentity } from "../detail/detail-model";
import { cvFailure, validateCvUpload, type CvResult } from "./cv-model";
import { uploadOrgCandidateCv } from "./cv-client";

/** Used by the bounded multipart Route Handler, never to send binary through a browser Server Action. */
export async function saveOrgCandidateCvAction(candidate: OrgCandidateIdentity, participationId: string, etag: string, cv: File): Promise<CvResult> {
 try {
  const token = await getActionAccessToken();
  if (!token?.trim()) return cvFailure(401, { code: "unauthenticated" });
  const invalid = validateCvUpload(candidate, participationId, etag, cv); if (invalid) return invalid;
  const me = await loadMe({ token });
  if (!me.ok) return cvFailure("status" in me.error ? me.error.status : undefined);
  if (me.data.role !== "recruiter") return cvFailure(403, { code: "forbidden" });
  return await uploadOrgCandidateCv(token, candidate, participationId, etag, cv);
 } catch { return cvFailure(); }
}
