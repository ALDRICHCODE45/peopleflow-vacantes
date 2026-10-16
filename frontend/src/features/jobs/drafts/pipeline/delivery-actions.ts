"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPublishedSaveFailure, type DraftPublishedSaveActionFailure } from "./failure";
import { getDraftDelivery, saveDraftDelivery, type DraftDelivery, type SaveDraftDeliveryInput } from "./delivery-client";

export type DraftDeliveryActionResult = { ok: true; delivery: DraftDelivery; etag: string } | DraftPublishedSaveActionFailure;
export async function loadDraftDeliveryAction(draftId: string): Promise<DraftDeliveryActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftDelivery({ token, draftId });
    return result.ok ? { ok: true, delivery: result.data, etag: result.etag } : mapDraftPublishedSaveFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
export async function saveDraftDeliveryAction(input: Omit<SaveDraftDeliveryInput, "token">): Promise<DraftDeliveryActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftDelivery({ ...input, token });
    return result.ok ? { ok: true, delivery: result.data, etag: result.etag } : mapDraftPublishedSaveFailure(result);
  } catch {
    // A write may have reached the API. Only an explicit GET may reconcile it.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
