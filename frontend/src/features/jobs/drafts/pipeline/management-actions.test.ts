import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./management-client", () => ({ getDraftManagement: vi.fn(), saveDraftManagement: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDraftManagement, saveDraftManagement } from "./management-client";
import { loadDraftManagementAction, saveDraftManagementAction } from "./management-actions";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const etag = '"management-opaque"';
const body = { requestDate: null, hiringHeadcount: null };
const management = { ...body, version: "0", limits: { maxHiringHeadcount: 999 }, today: "2026-10-16" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });
for (const operation of ["load", "save"] as const) describe(operation, () => {
  const client = operation === "load" ? getDraftManagement : saveDraftManagement;
  const call = () => operation === "load" ? loadDraftManagementAction(draftId) : saveDraftManagementAction({ draftId, ifMatch: etag, body });
  it.each([null, "", "   "])("requires token %j", async token => { vi.mocked(getActionAccessToken).mockResolvedValue(token); expect(await call()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(client).not.toHaveBeenCalled(); });
  it("returns only management/opaque ETag using explicit credentials", async () => {
    vi.mocked(client).mockResolvedValue({ ok: true, data: management, etag }); expect(await call()).toEqual({ ok: true, management, etag });
    expect(client).toHaveBeenCalledExactlyOnceWith({ token: "secret", draftId, ...(operation === "save" ? { ifMatch: etag, body } : {}) });
  });
  it.each([
    [400,"invalid_request","invalid_request"], [400,"validation_error","validation_error"], [401,"unauthenticated","unauthenticated"], [403,"forbidden","forbidden"], [403,"company_inactive","company_inactive"], [404,"not_found","not_found"], [409,"company_not_active","company_not_active"], [412,"version_conflict","version_conflict"], [413,"payload_too_large","payload_too_large"], [428,"precondition_required","precondition_required"], [500,"internal_error","server_error"],
  ] as const)("maps %s %s safely", async (status, code, reason) => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe secret", code } }); expect(await call()).toEqual({ ok: false, reason, reference: { status, code } }); expect(client).toHaveBeenCalledTimes(1);
  });
  it.each([["missing_token","unauthenticated"],["invalid_request","invalid_request"],["network","no_response"],["timeout","no_response"],["invalid_response","unrecognized_response"]] as const)("maps %s", async (kind, reason) => { vi.mocked(client).mockResolvedValue({ ok: false, error: { kind, retryable: false } }); expect(await call()).toEqual({ ok: false, reason, reference: {} }); });
  it("carries publication missing codes without the backend message", async () => {
    const missing = ["hiring_headcount_missing", "future"];
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status: 422, retryable: false }, envelope: { error: "unsafe", code: "publication_incomplete", missing } });
    expect(await call()).toEqual({ ok: false, reason: "publication_incomplete", missing, reference: { status: 422, code: "publication_incomplete" } });
    expect(client).toHaveBeenCalledTimes(1);
  });
  it.each([
    [422, { error: "unsafe", code: "other", missing: ["title_missing"] }],
    [422, { error: "unsafe", code: "publication_incomplete" }],
    [422, { error: "unsafe", code: "publication_incomplete", missing: [" "] }],
    [400, { error: "unsafe", code: "publication_incomplete", missing: ["title_missing"] }],
  ] as const)("does not classify a non-publication or malformed 422 %#", async (status, envelope) => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope } as never);
    expect(await call()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  });
  it("does not forward unknown codes or messages", async () => { vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status: 418, retryable: false }, envelope: { error: "unsafe", code: "unsafe" } }); expect(await call()).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 418 } }); });
  it("never retries thrown client errors", async () => { vi.mocked(client).mockRejectedValue(new Error("unsafe")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(client).toHaveBeenCalledTimes(1); });
  it("handles session failure without client", async () => { vi.mocked(getActionAccessToken).mockRejectedValue(new Error("unsafe")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(client).not.toHaveBeenCalled(); });
});
