"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { orgCandidateIdentitySchema, type OrgCandidateIdentity } from "../detail/detail-model";
import { patchOrgCandidate } from "./edit-client";
import { candidateEditBodySchema, classifyCandidateEditFailure, type CandidateEditBody, type CandidateEditResult } from "./edit-model";
import { etagSchema } from "@/features/pipeline-movement/model";

export async function saveOrgCandidateEditAction(candidate: OrgCandidateIdentity, etag: string, body: CandidateEditBody): Promise<CandidateEditResult> {
 try {
  const token = await getActionAccessToken();
  if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
  // Pick identity explicitly: callers may pass the entire detail, never forward it.
  const identity = orgCandidateIdentitySchema.safeParse({ kind: candidate.kind, id: candidate.id });
  const parsed = candidateEditBodySchema.safeParse(body);
  if (!identity.success || !etagSchema.safeParse(etag).success || !parsed.success || (identity.data.kind === "manual" && parsed.data.reset?.length)) return { ok: false, reason: "invalid_request", reference: {} };
  const result = await patchOrgCandidate(token, identity.data, etag, parsed.data);
  if (result.ok) return { ok: true, data: result.data };
  const status = "status" in result.error ? result.error.status : undefined;
  const envelope = "envelope" in result ? result.envelope : undefined;
  const reason = classifyCandidateEditFailure(status, envelope?.code, result.error.kind);
  const safeCodes = new Set(["precondition_failed", "precondition_required", "validation_error", "invalid_request", "not_found", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "internal_error"]);
  const code = envelope?.code && safeCodes.has(envelope.code) ? envelope.code : undefined;
  return { ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) }, ...(reason === "validation_error" && envelope?.fields ? { fields: envelope.fields } : {}) };
 } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
