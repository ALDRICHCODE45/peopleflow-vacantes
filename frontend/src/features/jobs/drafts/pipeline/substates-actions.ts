"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPipelineFailure, type DraftPipelineActionFailure } from "./failure";
import { getDraftSubstates, saveDraftSubstates, type DraftSubstates, type SaveDraftSubstatesInput } from "./substates-client";

export type DraftSubstatesActionResult = { ok: true; catalog: DraftSubstates; etag: string } | DraftPipelineActionFailure;
export async function loadDraftSubstatesAction(draftId: string): Promise<DraftSubstatesActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftSubstates({ token, draftId });
    return result.ok ? { ok: true, catalog: result.data, etag: result.etag } : mapDraftPipelineFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
export async function saveDraftSubstatesAction(input: Omit<SaveDraftSubstatesInput, "token">): Promise<DraftSubstatesActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftSubstates({ ...input, token });
    return result.ok ? { ok: true, catalog: result.data, etag: result.etag } : mapDraftPipelineFailure(result);
  } catch {
    // A write may have reached the API. Only an explicit GET may reconcile it.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
