"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { mapDraftPublishedSaveFailure, type DraftPublishedSaveActionFailure } from "./failure";
import { getDraftDelivery, saveDraftDelivery, getDeliveryStatus, previewDraftDelivery, renegotiateDraftCommitment, type DraftDelivery, type SaveDraftDeliveryInput, type RenegotiateDraftCommitmentInput } from "./delivery-client";

import type { DeliveryStatus, DeliveryPreview } from "./fulfillment-model";

export type DeliveryActionFailure = DraftPublishedSaveActionFailure | { ok: false; reason: "fulfillment_confirmation_required" | "delivery_fulfilled" | "vacancy_not_published" | "delivery_not_configured" | "commitment_unchanged" | "commitment_note_required" | "commitment_change_requires_renegotiation" | "idempotency_conflict"; reference: { status?: number; code?: string } };
function mapFailure(input: Parameters<typeof mapDraftPublishedSaveFailure>[0]): DeliveryActionFailure {
  const code = input.envelope?.code;
  if (input.error.status === 422 && code === "commitment_note_required") return { ok: false, reason: code, reference: { status: 422, code } };
  if (input.error.status === 409 && (code === "fulfillment_confirmation_required" || code === "delivery_fulfilled" || code === "vacancy_not_published" || code === "delivery_not_configured" || code === "commitment_unchanged" || code === "commitment_change_requires_renegotiation" || code === "idempotency_conflict")) return { ok: false, reason: code, reference: { status: 409, code } };
  return mapDraftPublishedSaveFailure(input);
}
export type DeliveryStatusActionResult = { ok: true; status: DeliveryStatus } | DeliveryActionFailure;
export type DeliveryPreviewActionResult = { ok: true; preview: DeliveryPreview } | DeliveryActionFailure;
export async function loadDeliveryStatusAction(draftId: string): Promise<DeliveryStatusActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDeliveryStatus({ token, draftId });
    return result.ok ? { ok: true, status: result.data } : mapFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function previewDraftDeliveryAction(input: { draftId: string; body: unknown }): Promise<DeliveryPreviewActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await previewDraftDelivery({ ...input, token });
    return result.ok ? { ok: true, preview: result.data } : mapFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export type DraftDeliveryActionResult = { ok: true; delivery: DraftDelivery; etag: string } | DeliveryActionFailure;
export async function loadDraftDeliveryAction(draftId: string): Promise<DraftDeliveryActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await getDraftDelivery({ token, draftId });
    return result.ok ? { ok: true, delivery: result.data, etag: result.etag } : mapFailure(result);
  } catch {
    return { ok: false, reason: "no_response", reference: {} };
  }
}
export async function renegotiateDraftCommitmentAction(input: Omit<RenegotiateDraftCommitmentInput, "token">): Promise<DraftDeliveryActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await renegotiateDraftCommitment({ ...input, token });
    return result.ok ? { ok: true, delivery: result.data, etag: result.etag } : mapFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function saveDraftDeliveryAction(input: Omit<SaveDraftDeliveryInput, "token">): Promise<DraftDeliveryActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await saveDraftDelivery({ ...input, token });
    return result.ok ? { ok: true, delivery: result.data, etag: result.etag } : mapFailure(result);
  } catch {
    // A write may have reached the API. Only an explicit GET may reconcile it.
    return { ok: false, reason: "no_response", reference: {} };
  }
}
