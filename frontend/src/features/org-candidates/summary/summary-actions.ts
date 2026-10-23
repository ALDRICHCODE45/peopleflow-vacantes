"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getCandidatesSummary, type SummaryClientFailure } from "./summary-client";
import type { CandidatesSummaryFailure, CandidatesSummaryResult } from "./summary-model";

const safeCodes = new Set(["unauthenticated", "forbidden", "not_a_member", "not_found", "company_inactive", "company_not_active", "internal_error"]);
function failure({ error, envelope }: SummaryClientFailure): CandidatesSummaryFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: CandidatesSummaryFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (status === 403 || status === 409) reason = "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status && status >= 500) reason = "server_error";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}

/** Only decoded counts and allowlisted failure metadata cross the server boundary. */
export async function getCandidatesSummaryAction(): Promise<CandidatesSummaryResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getCandidatesSummary({ token });
    return result.ok ? { ok: true, data: result.data } : failure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
