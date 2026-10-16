"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPublicationFailure, type DraftPublicationActionFailure } from "./failure";
import { getDraftPublication, publishDraft, type DraftPublication, type PublishedDraft, type PublishDraftInput } from "./publication-client";

export type DraftPublicationActionResult = { ok: true; publication: DraftPublication } | DraftPublicationActionFailure;
export type PublishDraftActionResult = { ok: true; publication: PublishedDraft } | DraftPublicationActionFailure;
export async function loadDraftPublicationAction(draftId: string): Promise<DraftPublicationActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftPublication({ token, draftId });
    return result.ok ? { ok: true, publication: result.data } : mapDraftPublicationFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function publishDraftAction(input: Omit<PublishDraftInput, "token">): Promise<PublishDraftActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await publishDraft({ ...input, token });
    return result.ok ? { ok: true, publication: result.data } : mapDraftPublicationFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
