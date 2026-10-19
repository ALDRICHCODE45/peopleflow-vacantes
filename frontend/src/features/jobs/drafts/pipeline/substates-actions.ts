"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPipelineFailure, type DraftPipelineActionFailure } from "./failure";
import { getDraftSubstates, saveDraftSubstates, type DraftSubstatesFailure, type DraftSubstates, type SaveDraftSubstatesInput } from "./substates-client";

import { substateErrorSchema } from "./substates-contract";

export type SubstateInUseFailure = { ok: false; reason: "substate_in_use"; details: { substate_id: string }[]; reference: { status: number; code: string } };
export type DraftSubstatesActionResult = { ok: true; catalog: DraftSubstates; etag: string } | DraftPipelineActionFailure;
export type DraftSubstatesSaveActionResult = DraftSubstatesActionResult | SubstateInUseFailure;
function mapSubstatesFailure(result: DraftSubstatesFailure): DraftPipelineActionFailure | SubstateInUseFailure {
  const parsed = substateErrorSchema.safeParse(result.envelope);
  if (result.error.status === 409 && parsed.success && parsed.data.code === "substate_in_use" && "details" in parsed.data) {
    return { ok: false, reason: "substate_in_use", details: parsed.data.details, reference: { status: 409, code: "substate_in_use" } };
  }
  return mapDraftPipelineFailure(result);
}
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
export async function saveDraftSubstatesAction(input: Omit<SaveDraftSubstatesInput, "token">): Promise<DraftSubstatesSaveActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftSubstates({ ...input, token });
    return result.ok ? { ok: true, catalog: result.data, etag: result.etag } : mapSubstatesFailure(result);
  } catch {
    // A write may have reached the API. Only an explicit GET may reconcile it.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
