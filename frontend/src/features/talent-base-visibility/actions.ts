"use server";

import { z } from "zod";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getTalentBaseVisibility, putTalentBaseVisibility } from "./client";
import {
  TALENT_BASE_MODES, etagForVersion,
  type TalentBaseFailure, type TalentBaseLoadResult, type TalentBaseSaveResult,
} from "./model";

const saveInputSchema = z.object({
  mode: z.enum(TALENT_BASE_MODES),
  userIds: z.array(z.string().uuid()).refine(ids => new Set(ids).size === ids.length),
  version: z.number().int().min(1),
});
const REFERENCE_CODES = new Set([
  "forbidden", "validation_error", "invalid_request", "precondition_required", "talent_base_visibility_version_conflict",
  "talent_base_users_not_applicable", "talent_base_viewer_not_member", "talent_base_viewer_is_owner", "unauthenticated",
]);
const noResponse: TalentBaseFailure = { ok: false, reason: "no_response", reference: {} };
const unauthenticated: TalentBaseFailure = { ok: false, reason: "unauthenticated", reference: {} };
const invalid: TalentBaseFailure = { ok: false, reason: "invalid_request", reference: {} };
const INDEXED = /^user_ids\[(\d+)\]$/;

type Failed = Awaited<ReturnType<typeof putTalentBaseVisibility>> & { ok: false };

/** Only allowlisted codes, the current document and submitted ids cross the action boundary; never backend messages. */
function failure(result: Failed, submitted: readonly string[] = []): TalentBaseFailure {
  const status = "status" in result.error ? result.error.status : undefined;
  const body = result.envelope;
  const code = body?.code;
  const reference = { ...(status === undefined ? {} : { status }), ...(code && REFERENCE_CODES.has(code) ? { code } : {}) };
  const fail = (reason: TalentBaseFailure["reason"], extra: Partial<TalentBaseFailure> = {}): TalentBaseFailure => ({ ok: false, reason, reference, ...extra });
  const fields = body?.kind === "envelope" ? body.fields ?? [] : [];
  const ids = fields.flatMap(({ field }) => {
    const index = INDEXED.exec(field)?.[1];
    const id = index === undefined ? undefined : submitted[Number(index)];
    return id ? [id] : [];
  });
  if (status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  if (status === 412) return fail("version_conflict", body?.kind === "document" ? { document: body.document } : {});
  if (status === 428) return fail("invalid_request");
  if (status === 400) {
    if (code !== "validation_error") return fail("invalid_request");
    const named = [...new Set(fields.map(item => item.field).filter(field => field === "mode" || field === "user_ids"))];
    return fail("validation_error", { fields: named, userIds: ids });
  }
  if (status === 422) {
    if (code === "talent_base_users_not_applicable") return fail("users_not_applicable");
    if (code === "talent_base_viewer_not_member") return fail("viewer_not_member", { userIds: ids });
    if (code === "talent_base_viewer_is_owner") return fail("viewer_is_owner", { userIds: ids });
    return fail("unrecognized_response");
  }
  if (status !== undefined && status >= 500 && status < 600) return fail("server_error");
  if (result.error.kind === "network" || result.error.kind === "timeout") return fail("no_response");
  return fail("unrecognized_response");
}

export async function loadTalentBaseVisibilityAction(): Promise<TalentBaseLoadResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await getTalentBaseVisibility(token);
    return result.ok ? { ok: true, document: result.data } : failure(result);
  } catch { return noResponse; }
}

/** `version` is the loaded document's version; it becomes the strong ETag `"N"` sent as If-Match. */
export async function saveTalentBaseVisibilityAction(input: { mode: "all_recruiters" | "selected_users"; userIds: string[]; version: number }): Promise<TalentBaseSaveResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const parsed = saveInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    // user_ids must be empty unless selected_users: a stale picker selection never travels with the default mode.
    const userIds = parsed.data.mode === "selected_users" ? parsed.data.userIds : [];
    const result = await putTalentBaseVisibility(token, etagForVersion(parsed.data.version), { mode: parsed.data.mode, user_ids: userIds });
    return result.ok ? { ok: true, document: result.data } : failure(result, userIds);
  } catch { return noResponse; }
}
