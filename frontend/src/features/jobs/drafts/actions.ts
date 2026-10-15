"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { createDraftV2, saveDraftV2, type DraftV2Failure } from "./api/client-v2";

export type DraftSaveReason = "unauthenticated" | "forbidden" | "company_inactive" | "not_found" | "company_not_active" | "idempotency_conflict" | "version_conflict" | "precondition_required" | "invalid_request" | "payload_too_large" | "server_error" | "no_response" | "unrecognized_response";
export type DraftSaveResult =
  | { ok: true; draftId: string; etag: string; version: string; savedAt: string; replayed?: boolean }
  | { ok: false; reason: DraftSaveReason; reference: { status?: number; code?: string } };
export type SaveDraftV2ActionInput = { draftId?: string; etag?: string; idempotencyKey?: string; body: unknown };

function failureReason({ error, envelope }: DraftV2Failure): DraftSaveReason {
  if (error.kind === "missing_token") return "unauthenticated";
  if (error.kind === "invalid_request") return "invalid_request";
  if (error.kind === "not_found") return "not_found";
  if (error.kind === "network" || error.kind === "timeout") return "no_response";
  if (error.kind !== "status") return "unrecognized_response";
  switch (error.status) {
    case 401: return "unauthenticated";
    case 403: return envelope?.code === "company_inactive" ? "company_inactive" : "forbidden";
    case 404: return "not_found";
    case 409:
      if (envelope?.code === "company_not_active") return "company_not_active";
      if (envelope?.code === "idempotency_conflict") return "idempotency_conflict";
      return "unrecognized_response";
    case 412: return "version_conflict";
    case 428: return "precondition_required";
    case 400: return "invalid_request";
    case 413: return "payload_too_large";
    default: return error.status >= 500 && error.status < 600 ? "server_error" : "unrecognized_response";
  }
}

/** One explicit write; only safe reference codes and save metadata leave the server. */
export async function saveDraftV2Action(input: SaveDraftV2ActionInput): Promise<DraftSaveResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = input.draftId === undefined
      ? await createDraftV2({ token, idempotencyKey: input.idempotencyKey ?? "", body: input.body })
      : await saveDraftV2({ token, id: input.draftId, ifMatch: input.etag ?? "", body: input.body });
    if (!result.ok) return { ok: false, reason: failureReason(result), reference: {
      ...("status" in result.error ? { status: result.error.status } : {}),
      ...(result.envelope ? { code: result.envelope.code } : {}),
    } };
    return {
      ok: true,
      draftId: result.data.id,
      etag: result.etag,
      version: result.data.version,
      savedAt: result.data.updated_at,
      ...("idempotencyReplayed" in result ? { replayed: result.idempotencyReplayed === "true" } : {}),
    };
  } catch {
    // The request may already have reached the API. Never retry implicitly.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
