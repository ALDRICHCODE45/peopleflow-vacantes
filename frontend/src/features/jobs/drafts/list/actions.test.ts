import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ listDrafts: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listDrafts } from "./client";
import { listDraftsAction } from "./actions";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });
it("does not call client without token", async () => {
 vi.mocked(getActionAccessToken).mockResolvedValue(null);
 expect(await listDraftsAction({})).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(listDrafts).not.toHaveBeenCalled();
});
it("returns serializable list and passes pagination", async () => {
 vi.mocked(listDrafts).mockResolvedValue({ ok: true, data: { items: [], next_cursor: "opaque+/=" } });
 expect(await listDraftsAction({ cursor: "opaque+/=", limit: 20 })).toEqual({ ok: true, items: [], nextCursor: "opaque+/=" });
 expect(listDrafts).toHaveBeenCalledWith({ token: "secret", cursor: "opaque+/=", limit: 20 });
});
it.each([[400,"invalid_request","invalid_request"], [401,"unauthenticated","unauthenticated"], [403,"forbidden","forbidden"], [403,"company_inactive","company_inactive"], [409,"company_not_active","company_not_active"], [500,"internal_error","server_error"]] as const)("maps %s %s safely", async (status, code, reason) => {
 vi.mocked(listDrafts).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe secret", code } });
 const result = await listDraftsAction({}); expect(result).toEqual({ ok: false, reason, reference: { status, code } }); expect(JSON.stringify(result)).not.toMatch(/unsafe|secret/);
});
it.each(["network", "timeout", "invalid_response", "invalid_request"] as const)("maps %s", async kind => {
 vi.mocked(listDrafts).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
 expect(await listDraftsAction({})).toMatchObject({ ok: false, reason: kind === "invalid_request" ? "invalid_request" : kind === "invalid_response" ? "unrecognized_response" : "no_response" });
});
it("does not forward unknown backend code or exception details", async () => {
 vi.mocked(listDrafts).mockResolvedValue({ ok: false, error: { kind: "status", status: 418, retryable: false }, envelope: { error: "secret", code: "secret" } });
 expect(await listDraftsAction({})).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 418 } });
 vi.mocked(listDrafts).mockRejectedValue(new Error("secret"));
 expect(await listDraftsAction({})).toEqual({ ok: false, reason: "no_response", reference: {} });
});
