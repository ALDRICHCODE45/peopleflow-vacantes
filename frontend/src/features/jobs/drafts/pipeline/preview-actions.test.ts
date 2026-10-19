import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ previewPipeline: vi.fn(), getDraftPipeline: vi.fn(), saveDraftPipeline: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { previewPipeline, saveDraftPipeline } from "./client";
import { previewPipelineAction } from "./actions";
import { mapDraftPipelineFailure } from "./failure";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const body = { stages: [{ name: "Prueba" }], exit: { id: draftId, name: "Descartados" } };
const preview = { stages: [], not_applicable: [], recovery_reassigned: [], has_impact: false };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });
it.each([null, "", " "])("requires a session (%s), without any request", async token => {
  vi.mocked(getActionAccessToken).mockResolvedValue(token);
  expect(await previewPipelineAction({ draftId, body })).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(previewPipeline).not.toHaveBeenCalled(); expect(saveDraftPipeline).not.toHaveBeenCalled();
});
it("returns only preview data and forwards credentials/body without an ETag", async () => {
  vi.mocked(previewPipeline).mockResolvedValue({ ok: true, data: preview });
  expect(await previewPipelineAction({ draftId, body })).toEqual({ ok: true, preview });
  expect(previewPipeline).toHaveBeenCalledExactlyOnceWith({ token: "token", draftId, body });
  expect(saveDraftPipeline).not.toHaveBeenCalled();
});
it.each(["stage_occupied", "cutoff_stage_in_use", "impact_confirmation_required"])("maps %s once without exposing messages", async code => {
  vi.mocked(previewPipeline).mockResolvedValue({ ok: false, error: { kind: "status", status: 409, retryable: false }, envelope: { code, error: "private", ...(code === "stage_occupied" ? { details: [{ stage_id: draftId }] } : {}) } });
  expect(await previewPipelineAction({ draftId, body })).toEqual({ ok: false, reason: code, reference: { status: 409, code }, ...(code === "stage_occupied" ? { details: [{ stage_id: draftId }] } : {}) });
  expect(previewPipeline).toHaveBeenCalledTimes(1); expect(saveDraftPipeline).not.toHaveBeenCalled();
});
it.each(["network", "timeout", "invalid_response"] as const)("maps transport %s without retries", async kind => {
  vi.mocked(previewPipeline).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
  expect(await previewPipelineAction({ draftId, body })).toEqual({ ok: false, reason: kind === "invalid_response" ? "unrecognized_response" : "no_response", reference: {} });
  expect(previewPipeline).toHaveBeenCalledTimes(1);
});
it.each(["session", "client"])("contains thrown %s errors", async source => {
  if (source === "session") vi.mocked(getActionAccessToken).mockRejectedValue(new Error("private"));
  else vi.mocked(previewPipeline).mockRejectedValue(new Error("private"));
  expect(await previewPipelineAction({ draftId, body })).toEqual({ ok: false, reason: "no_response", reference: {} });
  expect(previewPipeline).toHaveBeenCalledTimes(source === "session" ? 0 : 1);
});
it("shared failure mapper accepts substate details but does not forward them as stage ids", () => {
  const result = mapDraftPipelineFailure({ ok: false, error: { kind: "status", status: 409, retryable: false }, envelope: { code: "substate_in_use", error: "private", details: [{ substate_id: draftId }] } });
  expect(result).not.toHaveProperty("details");
});
