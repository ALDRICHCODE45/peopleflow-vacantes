"use server";

import { z } from "zod";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { orgCandidateIdentitySchema, type DetailFailure, type OrgCandidateIdentity } from "../detail/detail-model";
import { fetchOrgCandidateHistory } from "./history-client";
import type { HistoryResult } from "./history-model";

const safeCodes = new Set(["not_found", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "internal_error"]);
const cursorSchema = z.string().min(1).optional();
/** Only validated events and safe failure classifications cross the server boundary. */
export async function loadOrgCandidateHistoryAction(candidate: OrgCandidateIdentity, cursor?: string): Promise<HistoryResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const identity = orgCandidateIdentitySchema.safeParse(candidate);
    if (!identity.success) return { ok: false, reason: "not_found", reference: {} };
    const query = cursorSchema.safeParse(cursor);
    if (!query.success) return { ok: false, reason: "unrecognized_response", reference: {} };
    const result = await fetchOrgCandidateHistory(token, identity.data, query.data);
    if (result.ok) return { ok: true, data: result.data };
    const status = "status" in result.error ? result.error.status : undefined;
    const code = result.envelope && safeCodes.has(result.envelope.code) ? result.envelope.code : undefined;
    const reason: DetailFailure["reason"] = status === 404 ? "not_found" : status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status && status >= 500 ? "server_error" : result.error.kind === "network" || result.error.kind === "timeout" ? "no_response" : "unrecognized_response";
    return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
