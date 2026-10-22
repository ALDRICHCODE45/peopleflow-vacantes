"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listCandidates, type ListCandidatesFailure } from "./client";
import type { CandidateFailure, CandidateResult } from "./model";
import type { CandidateQuery } from "./url-state";
const safeCodes = new Set(["invalid_filter", "invalid_cursor", "unauthenticated", "forbidden", "not_a_member", "company_inactive", "company_not_active", "internal_error"]);
function failure({ error, envelope }: ListCandidatesFailure): CandidateFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: CandidateFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (status === 403 || status === 409) reason = "forbidden";
  else if (status === 400 && (code === "invalid_filter" || code === "invalid_cursor")) reason = code;
  else if (status && status >= 500) reason = "server_error";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  return { ok: false, reason, ...(reason === "invalid_filter" && envelope && "fields" in envelope ? { fields: envelope.fields } : {}), reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}
export async function listCandidatesAction(input: CandidateQuery = {}): Promise<CandidateResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await listCandidates({ ...input, token });
    return result.ok ? result : failure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
