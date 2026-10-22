import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { orgCandidateDetailSchema, type OrgCandidateIdentity } from "./detail-model";

const envelopeSchema = z.object({ error: z.string(), code: z.string() }).strict();

/** Guarded transport for one organization candidate; the action owns session and classification. */
export async function fetchOrgCandidateDetail(token: string, { kind, id }: OrgCandidateIdentity) {
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(`/v2/me/company/candidates/${kind}/${id}`, serverEnv.apiBaseUrl).toString(), {
    method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => orgCandidateDetailSchema.parse(value), errorDecoder: value => envelopeSchema.parse(value),
  });
}
