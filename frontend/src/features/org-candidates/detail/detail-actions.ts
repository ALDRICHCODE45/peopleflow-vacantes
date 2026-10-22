"use server";

import { z } from "zod";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { requestJson } from "@/lib/api/server";
import { orgCandidateDetailSchema, orgCandidateIdentitySchema, type DetailResult, type DetailFailure, type OrgCandidateIdentity } from "./detail-model";

const envelopeSchema = z.object({ error: z.string(), code: z.string() }).strict();
const safeCodes = new Set(["not_found", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "internal_error"]);
/** Only validated detail and safe classifications cross the server boundary. */
export async function loadOrgCandidateDetailAction(candidate: OrgCandidateIdentity): Promise<DetailResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const identity = orgCandidateIdentitySchema.safeParse(candidate);
    if (!identity.success) return { ok: false, reason: "not_found", reference: {} };
    const { serverEnv } = await import("@/lib/env/server");
    const { kind, id } = identity.data;
    const result = await requestJson(new URL(`/v2/me/company/candidates/${kind}/${id}`, serverEnv.apiBaseUrl).toString(), {
      method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
      timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
      decoder: value => orgCandidateDetailSchema.parse(value), errorDecoder: value => envelopeSchema.parse(value),
    });
    if (result.ok) {
      if (result.data.kind !== kind || result.data.id.toLowerCase() !== id.toLowerCase()) return { ok: false, reason: "unrecognized_response", reference: {} };
      return { ok: true, data: result.data };
    }
    const status = "status" in result.error ? result.error.status : undefined;
    const errorKind = result.error.kind;
    const code = result.envelope && safeCodes.has(result.envelope.code) ? result.envelope.code : undefined;
    const reason: DetailFailure["reason"] = status === 404 ? "not_found" : status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status && status >= 500 ? "server_error" : errorKind === "network" || errorKind === "timeout" ? "no_response" : "unrecognized_response";
    return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
