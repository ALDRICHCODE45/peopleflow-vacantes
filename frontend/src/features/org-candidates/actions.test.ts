import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ listCandidates: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listCandidates } from "./client";
import { listCandidatesAction } from "./actions";
import { page } from "./list/test-fixtures";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });
it("never calls transport without an authenticated session", async () => {
 vi.mocked(getActionAccessToken).mockResolvedValue(null);
 expect(await listCandidatesAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(listCandidates).not.toHaveBeenCalled();
});
it("passes filters and cursor and returns the decoded page", async () => {
 vi.mocked(listCandidates).mockResolvedValue({ ok: true, data: page });
 expect(await listCandidatesAction({ filters: { q: "Ana" }, cursor: "opaque" })).toEqual({ ok: true, data: page });
 expect(listCandidates).toHaveBeenCalledWith({ token: "token", filters: { q: "Ana" }, cursor: "opaque" });
});
it.each([[400, "invalid_cursor", "invalid_cursor"], [400, "invalid_filter", "invalid_filter"], [401, "unauthenticated", "unauthenticated"], [403, "forbidden", "forbidden"], [403, "not_a_member", "forbidden"], [500, "internal_error", "server_error"]] as const)("maps %s %s without leaking raw errors", async (status, code, reason) => {
 vi.mocked(listCandidates).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: code === "invalid_filter" ? { error: "secret", code, fields: [{ field: "vacancy", code: "not_found" }] } : { error: "secret", code } });
 const result = await listCandidatesAction(); expect(result).toMatchObject({ ok: false, reason }); expect(JSON.stringify(result)).not.toContain("secret");
 if (code === "invalid_filter") expect(result).toHaveProperty("fields", [{ field: "vacancy", code: "not_found" }]);
});
it("handles thrown transport failures safely", async () => {
 vi.mocked(listCandidates).mockRejectedValue(new Error("secret")); expect(await listCandidatesAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
});
