import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./substates-client", () => ({ getDraftSubstates: vi.fn(), saveDraftSubstates: vi.fn() }));
vi.mock("./client", () => ({ getDraftPipeline: vi.fn(), saveDraftPipeline: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDraftSubstates, saveDraftSubstates } from "./substates-client";
import { loadDraftSubstatesAction, saveDraftSubstatesAction } from "./substates-actions";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
// Independent from both the draft and columns ETags.
const etag = '"opaque-substates"';
const catalog = { version: "0", substates: [], limits: { maxSubstates: 50, nameMaxLength: 40 }, suggestions: [] };
const body = { substates: [{ name: "Prueba" }] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });
for (const operation of ["load", "save"] as const) describe(operation, () => {
  const client = operation === "load" ? getDraftSubstates : saveDraftSubstates;
  const call = () => operation === "load" ? loadDraftSubstatesAction(draftId) : saveDraftSubstatesAction({ draftId, ifMatch: etag, body });
  it.each([null, "", "   "])("requires token %j", async token => {
    vi.mocked(getActionAccessToken).mockResolvedValue(token); expect(await call()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(client).not.toHaveBeenCalled();
  });
  it("returns only catalog and opaque ETag with explicit server credentials", async () => {
    vi.mocked(client).mockResolvedValue({ ok: true, data: catalog, etag }); expect(await call()).toEqual({ ok: true, catalog, etag });
    expect(client).toHaveBeenCalledExactlyOnceWith({ token: "secret", draftId, ...(operation === "save" ? { ifMatch: etag, body } : {}) });
  });
  it.each([
    [400,"invalid_request","invalid_request"], [400,"validation_error","validation_error"], [401,"unauthenticated","unauthenticated"],
    [403,"forbidden","forbidden"], [403,"company_inactive","company_inactive"], [404,"not_found","not_found"], [409,"company_not_active","company_not_active"],
    [412,"version_conflict","version_conflict"], [413,"payload_too_large","payload_too_large"], [428,"precondition_required","precondition_required"],
    [500,"internal_error","server_error"], [599,"internal_error","server_error"], [400,"forbidden","unrecognized_response"], [409,"invalid_request","unrecognized_response"],
  ] as const)("maps %s %s with allowlisted reference and no details", async (status, code, reason) => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe secret", code } });
    expect(await call()).toEqual({ ok: false, reason, reference: { status, code } }); expect(client).toHaveBeenCalledTimes(1);
  });
  it.each([["missing_token","unauthenticated"],["invalid_request","invalid_request"],["network","no_response"],["timeout","no_response"],["invalid_response","unrecognized_response"]] as const)("maps %s", async (kind, reason) => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind, retryable: false } }); expect(await call()).toEqual({ ok: false, reason, reference: {} });
  });
  it.each([[400,"unrecognized_response"],[401,"unauthenticated"],[403,"forbidden"],[404,"not_found"],[409,"unrecognized_response"],[412,"version_conflict"],[413,"payload_too_large"],[428,"precondition_required"],[500,"server_error"]] as const)("classifies %s without envelope", async (status, reason) => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false } }); expect(await call()).toEqual({ ok: false, reason, reference: { status } });
  });
  it("does not forward unknown codes or messages", async () => {
    vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status: 418, retryable: false }, envelope: { error: "unsafe", code: "unsafe" } });
    expect(await call()).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 418 } });
  });
  it("does not retry thrown client errors", async () => { vi.mocked(client).mockRejectedValue(new Error("unsafe")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(client).toHaveBeenCalledTimes(1); });
  it("handles session failure without calling client", async () => { vi.mocked(getActionAccessToken).mockRejectedValue(new Error("unsafe")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(client).not.toHaveBeenCalled(); });
});
