"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDashboard, type DashboardClientFailure } from "./client";
import type { DashboardFailure, DashboardResult } from "./model";
const safeCodes = new Set(["unauthenticated", "forbidden", "not_a_member", "not_found", "company_inactive", "company_not_active", "internal_error"]);
function failure({ error, envelope }: DashboardClientFailure): DashboardFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: DashboardFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (status === 403 || status === 409) reason = "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status && status >= 500) reason = "server_error";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}
export async function getDashboardAction(): Promise<DashboardResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDashboard({ token });
    return result.ok ? { ok: true, data: result.data } : failure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
