"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPublishedSaveFailure, type DraftPublishedSaveActionFailure } from "./failure";
import { getDraftManagement, saveDraftManagement, type DraftManagement, type SaveDraftManagementInput } from "./management-client";

export type DraftManagementActionResult = { ok: true; management: DraftManagement; etag: string } | DraftPublishedSaveActionFailure;
export async function loadDraftManagementAction(draftId: string): Promise<DraftManagementActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftManagement({ token, draftId });
    return result.ok ? { ok: true, management: result.data, etag: result.etag } : mapDraftPublishedSaveFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
export async function saveDraftManagementAction(input: Omit<SaveDraftManagementInput, "token">): Promise<DraftManagementActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftManagement({ ...input, token });
    return result.ok ? { ok: true, management: result.data, etag: result.etag } : mapDraftPublishedSaveFailure(result);
  } catch {
    // A write may have reached the API. Only an explicit GET may reconcile it.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
