import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./me-client", () => ({ loadMe: vi.fn() }));
vi.mock("./candidate-account-client", () => ({ createCandidateAccount: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "./me-client";
import { createCandidateAccount } from "./candidate-account-client";
import { loadMeAction, createCandidateAccountAction } from "./actions";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("private-access"); });
describe("public identity actions", () => {
  it("fails closed without credentials", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await loadMeAction()).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(await createCandidateAccountAction({ full_name: "Ana" })).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(loadMe).not.toHaveBeenCalled(); expect(createCandidateAccount).not.toHaveBeenCalled();
  });
  it.each([[401, "unauthenticated", "unauthenticated"], [409, "account_exists", "account_exists"], [409, "email_in_use", "email_in_use"], [422, "email_not_verified", "email_not_verified"], [400, "validation_error", "validation_error"], [400, "invalid_request", "validation_error"], [503, "identity_unavailable", "identity_unavailable"], [500, "internal_error", "server_error"], [403, "private-code", "unrecognized_response"]])("maps %i/%s without raw errors", async (status, code, reason) => {
    vi.mocked(createCandidateAccount).mockResolvedValue({ ok: false, error: { kind: "status", status: Number(status) }, envelope: { error: "private-provider-detail", code: String(code) } });
    const result = await createCandidateAccountAction({ full_name: "Ana" });
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toMatch(/private-provider-detail|private-access|private-code/);
  });
  it.each(["network", "timeout", "invalid_response"] as const)("maps %s", async kind => {
    vi.mocked(loadMe).mockResolvedValue({ ok: false, error: { kind } });
    expect(await loadMeAction()).toMatchObject({ ok: false, reason: kind === "invalid_response" ? "unrecognized_response" : "no_response" });
  });
  it("returns identity only, never credentials, after a single write", async () => {
    const data = { role: "candidate", user: { id: "id", email: "ana@example.com", full_name: "Ana" } } as const;
    vi.mocked(createCandidateAccount).mockResolvedValue({ ok: true, data });
    expect(await createCandidateAccountAction({ full_name: "Ana" })).toEqual({ ok: true, data });
    expect(createCandidateAccount).toHaveBeenCalledTimes(1);
    expect(loadMe).not.toHaveBeenCalled();
  });
  it("collapses unexpected exceptions without retrying", async () => {
    vi.mocked(loadMe).mockRejectedValue(new Error("private"));
    expect(await loadMeAction()).toMatchObject({ ok: false, reason: "no_response" });
    expect(loadMe).toHaveBeenCalledTimes(1);
  });
});
