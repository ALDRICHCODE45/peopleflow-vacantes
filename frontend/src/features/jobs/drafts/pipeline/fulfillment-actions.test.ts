import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./delivery-client", () => ({ getDeliveryStatus: vi.fn(), previewDraftDelivery: vi.fn(), saveDraftDelivery: vi.fn(), getDraftDelivery: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDeliveryStatus, previewDraftDelivery, saveDraftDelivery } from "./delivery-client";
import { loadDeliveryStatusAction, previewDraftDeliveryAction, saveDraftDeliveryAction } from "./delivery-actions";
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const body = { cutoffStageId: draftId, targetQuantity: 2, commitmentDate: "2026-11-30" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });
it("status action returns only the decoded projection with server credentials", async () => {
  const data = { state: "pending" as const, delivered: 0, target: 2, cutoff_stage_id: draftId, commitment_date: "2026-11-30", business_days_remaining: 12, fulfillment: null };
  vi.mocked(getDeliveryStatus).mockResolvedValue({ ok: true, data });
  expect(await loadDeliveryStatusAction(draftId)).toEqual({ ok: true, status: data }); expect(getDeliveryStatus).toHaveBeenCalledExactlyOnceWith({ token: "secret", draftId });
});
it("preview action forwards the proposal without If-Match and no write", async () => {
  const data = { would_fulfill: false, delivered: 0, target: 2, candidates: [] };
  vi.mocked(previewDraftDelivery).mockResolvedValue({ ok: true, data });
  expect(await previewDraftDeliveryAction({ draftId, body })).toEqual({ ok: true, preview: data }); expect(previewDraftDelivery).toHaveBeenCalledExactlyOnceWith({ token: "secret", draftId, body }); expect(saveDraftDelivery).not.toHaveBeenCalled();
});
it.each(["delivery_fulfilled", "fulfillment_confirmation_required", "vacancy_not_published"] as const)("maps only the contractual 409 %s without forwarding messages", async code => {
  const failure = { ok: false as const, error: { kind: "status" as const, status: 409, retryable: false as const }, envelope: { code, error: "private" } };
  vi.mocked(saveDraftDelivery).mockResolvedValue(failure); vi.mocked(previewDraftDelivery).mockResolvedValue(failure); vi.mocked(getDeliveryStatus).mockResolvedValue(failure);
  for (const result of [await saveDraftDeliveryAction({ draftId, ifMatch: '"tag"', body }), await previewDraftDeliveryAction({ draftId, body }), await loadDeliveryStatusAction(draftId)]) expect(result).toEqual({ ok: false, reason: code, reference: { status: 409, code } });
});
it.each(["status", "preview"] as const)("%s requires a session and never retries exceptions", async operation => {
  const client = operation === "status" ? getDeliveryStatus : previewDraftDelivery;
  const call = () => operation === "status" ? loadDeliveryStatusAction(draftId) : previewDraftDeliveryAction({ draftId, body });
  vi.mocked(getActionAccessToken).mockResolvedValue(null); expect(await call()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(client).not.toHaveBeenCalled();
  vi.mocked(getActionAccessToken).mockResolvedValue("secret"); vi.mocked(client).mockRejectedValue(new Error("private")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(client).toHaveBeenCalledTimes(1);
});
