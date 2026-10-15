"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { listDrafts, type DraftListQuery, type DraftListRow, type ListDraftsFailure } from "./client";

export type DraftListActionFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "company_inactive" | "company_not_active" |
    "invalid_request" | "server_error" | "no_response" | "unrecognized_response";
  reference: { status?: number; code?: string };
};
export type DraftListActionResult =
  | { ok: true; items: DraftListRow[]; nextCursor: string | null }
  | DraftListActionFailure;

const safeCodes = new Set(["invalid_request", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "internal_error"]);

/** Only public classifications and allowlisted references cross the action boundary. */
function failure({ error, envelope }: ListDraftsFailure): DraftListActionFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: DraftListActionFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request" || (status === 400 && code === "invalid_request")) reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = code === "company_inactive" ? "company_inactive" : "forbidden";
  else if (status === 409 && code === "company_not_active") reason = "company_not_active";
  else if (status && status >= 500 && status < 600) reason = "server_error";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}

export async function listDraftsAction(input: DraftListQuery = {}): Promise<DraftListActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await listDrafts({ ...input, token });
    return result.ok ? { ok: true, items: result.data.items, nextCursor: result.data.next_cursor } : failure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
