import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), get: vi.fn(), languages: vi.fn(), put: vi.fn(), putLanguages: vi.fn() }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: mocks.token }));
vi.mock("./profile-client", () => ({ getProfile: mocks.get, getProfileLanguages: mocks.languages, putProfile: mocks.put, putProfileLanguages: mocks.putLanguages }));
import { loadProfileAction, saveProfileAction } from "./profile-actions";
const profile = { user_id: "11111111-1111-4111-8111-111111111111", location: null, salary_currency: "MXN", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.token.mockResolvedValue("session-token");
  mocks.get.mockResolvedValue({ ok: true, data: profile }); mocks.languages.mockResolvedValue({ ok: true, data: { languages: [] } });
  mocks.put.mockResolvedValue({ ok: true, data: profile }); mocks.putLanguages.mockResolvedValue({ ok: true, data: { languages: [] } });
});
describe("profile server actions", () => {
  it("reads both endpoints for loading and read-only reconciliation", async () => {
    expect(await loadProfileAction()).toEqual({ ok: true, data: { profile, languages: { languages: [] } } });
    expect(mocks.get).toHaveBeenCalledWith({ token: "session-token" });
    expect(mocks.languages).toHaveBeenCalledWith({ token: "session-token" });
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.putLanguages).not.toHaveBeenCalled();
  });
  it("does not expose an incomplete load as success", async () => {
    mocks.languages.mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
    expect(await loadProfileAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
  });
  it("opens a new profile on 404 and retains independently saved languages", async () => {
    mocks.get.mockResolvedValue({ ok: false, reason: "not_found", reference: { status: 404 } });
    const languages = { languages: [{ name: "english", level: "B2" }] };
    mocks.languages.mockResolvedValue({ ok: true, data: languages });
    expect(await loadProfileAction()).toEqual({ ok: true, data: { profile: null, languages } });
    mocks.languages.mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
    expect(await loadProfileAction()).toMatchObject({ ok: false, reason: "no_response" });
  });
  it("guards requests with the session token", async () => {
    mocks.token.mockResolvedValue(null);
    expect(await loadProfileAction()).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(await saveProfileAction({ profile: {} })).toMatchObject({ kind: "failed", failure: { reason: "unauthenticated" } });
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it("retains confirmed profile success when the languages call throws", async () => {
    mocks.putLanguages.mockRejectedValue(new Error("private detail"));
    expect(await saveProfileAction({ profile: {}, languages: { languages: [] } })).toEqual({ kind: "uncertain", part: "languages", profile, failure: { ok: false, reason: "no_response", reference: {} } });
  });
  it("rejects malformed action input before any mutation", async () => {
    expect((await saveProfileAction(null)).kind).toBe("invalid");
    expect((await saveProfileAction({ other: "ignored?" })).kind).toBe("invalid");
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.putLanguages).not.toHaveBeenCalled();
  });
});
