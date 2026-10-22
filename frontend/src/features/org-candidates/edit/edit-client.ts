import "server-only";
import { requestJson } from "@/lib/api/server";
import { orgCandidateDetailSchema, orgCandidateIdentitySchema, type OrgCandidateIdentity } from "../detail/detail-model";
import { etagSchema } from "@/features/pipeline-movement/model";
import { candidateEditBodySchema, candidateEditDetailFieldsSchema, editErrorEnvelopeSchema, type CandidateEditBody } from "./edit-model";

/** Auth stays on the server; reject unsafe path/header/body inputs before transport. */
export async function patchOrgCandidate(token: string, candidate: OrgCandidateIdentity, etag: string, body: CandidateEditBody) {
 const identity = orgCandidateIdentitySchema.safeParse(candidate);
 const tag = etagSchema.safeParse(etag);
 const patch = candidateEditBodySchema.safeParse(body);
 if (!token.trim() || !identity.success || !tag.success || !patch.success || (identity.data.kind === "manual" && patch.data.reset?.length)) return { ok: false, error: { kind: "invalid_request" as const } } as const;
 const { serverEnv } = await import("@/lib/env/server");
 const { kind, id } = identity.data;
 return requestJson(new URL(`/v2/me/company/candidates/${kind}/${id}`, serverEnv.apiBaseUrl).toString(), {
  method: "PATCH", headers: { authorization: `Bearer ${token.trim()}`, "If-Match": tag.data }, body: patch.data,
  redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
  decoder: value => {
   const detail = orgCandidateDetailSchema.extend(candidateEditDetailFieldsSchema.shape).parse(value);
   if (detail.kind !== kind || detail.id.toLowerCase() !== id.toLowerCase()) throw new Error("Unexpected candidate identity");
   return detail;
  },
  errorDecoder: value => editErrorEnvelopeSchema.parse(value),
 });
}
