"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { listStakeholderVacancies, type StakeholderVacanciesFailure } from "./client";
import type { StakeholderVacancy, StatusCounts } from "./model";

export type StakeholderVacanciesFailureReason = "unauthenticated" | "forbidden" | "invalid_request" | "server_error" | "no_response" | "unrecognized_response";
export type StakeholderVacanciesActionResult =
  | { ok: true; items: StakeholderVacancy[]; nextCursor: string | null; countsByStatus?: StatusCounts | null }
  | { ok: false; reason: StakeholderVacanciesFailureReason; reference: { status?: number; code?: string } };

const safeCodes = new Set(["invalid_request", "unauthenticated", "forbidden", "internal_error"]);

/** Only public classifications and allowlisted references cross the action boundary: the backend text never reaches the browser. */
function failure({ error, envelope }: StakeholderVacanciesFailure): Extract<StakeholderVacanciesActionResult, { ok: false }> {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: StakeholderVacanciesFailureReason = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request" || (status === 400 && code === "invalid_request")) reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = "forbidden";
  else if (status && status >= 500 && status < 600) reason = "server_error";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}

/** S12: one keyset page of the stakeholder's vacancies; no `cursor` is the first page (the backend's default size). */
export async function loadStakeholderVacanciesAction(input: { cursor?: string } = {}): Promise<StakeholderVacanciesActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await listStakeholderVacancies({ token, ...(input?.cursor === undefined ? {} : { cursor: input.cursor }) });
    return result.ok ? { ok: true, items: result.data.items, nextCursor: result.data.next_cursor, countsByStatus: result.data.counts_by_status ?? null } : failure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
