import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { orgCandidateIdentitySchema, type OrgCandidateIdentity } from "../detail/detail-model";
import { orgCandidateHistorySchema } from "./history-model";

const envelopeSchema = z.object({ error: z.string(), code: z.string() }).strict();
/** Session stays on the server; cursors are opaque query values, never path fragments. */
export async function fetchOrgCandidateHistory(token: string, candidate: OrgCandidateIdentity, cursor?: string) {
  const { kind, id } = orgCandidateIdentitySchema.parse(candidate);
  const { serverEnv } = await import("@/lib/env/server");
  const url = new URL(`/v2/me/company/candidates/${kind}/${id}/history`, serverEnv.apiBaseUrl);
  url.searchParams.set("limit", "20");
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  return requestJson(url.toString(), {
    method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => orgCandidateHistorySchema.parse(value), errorDecoder: value => envelopeSchema.parse(value),
  });
}
