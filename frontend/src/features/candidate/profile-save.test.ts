import { describe, expect, it, vi } from "vitest";
import { saveProfileParts, type ProfileSavePort } from "./profile-save";
import type { ProfileFailure, ProfileRead } from "./profile-api";
const profile: ProfileRead = { user_id: "11111111-1111-4111-8111-111111111111", location: null, salary_currency: "MXN", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const languages = { languages: [{ code: "en", level: "B2" as const }] };
const failure: ProfileFailure = { ok: false, reason: "invalid_request", reference: { status: 400 } };
function port() {
  return { putProfile: vi.fn<ProfileSavePort["putProfile"]>().mockResolvedValue({ ok: true, data: profile }), putLanguages: vi.fn<ProfileSavePort["putLanguages"]>().mockResolvedValue({ ok: true, data: languages }) };
}
describe("profile save sequencing without retries", () => {
  it("saves both in order and returns canonical baselines", async () => {
    const api = port();
    const result = await saveProfileParts({ profile: { location: null }, languages }, api);
    expect(result).toEqual({ kind: "saved", profile, languages });
    expect(api.putProfile.mock.invocationCallOrder[0]).toBeLessThan(api.putLanguages.mock.invocationCallOrder[0]);
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putLanguages).toHaveBeenCalledTimes(1);
  });
  it("skips unchanged blocks, including a completely clean form", async () => {
    const api = port();
    expect(await saveProfileParts({}, api)).toEqual({ kind: "unchanged" });
    expect(api.putProfile).not.toHaveBeenCalled();
    expect(api.putLanguages).not.toHaveBeenCalled();
    expect(await saveProfileParts({ languages }, api)).toEqual({ kind: "saved", languages });
    expect(api.putProfile).not.toHaveBeenCalled();
    api.putLanguages.mockClear();
    expect(await saveProfileParts({ profile: {} }, api)).toEqual({ kind: "saved", profile });
    expect(api.putLanguages).not.toHaveBeenCalled();
  });
  it("validates both blocks before any write, including an empty language level", async () => {
    const api = port();
    expect((await saveProfileParts({ profile: {}, languages: { languages: [{ code: "en", level: "" }] } }, api)).kind).toBe("invalid");
    expect((await saveProfileParts({ profile: { location: { country: "MX", postal_code: null } }, languages }, api)).kind).toBe("invalid");
    expect(api.putProfile).not.toHaveBeenCalled();
    expect(api.putLanguages).not.toHaveBeenCalled();
  });
  it("does not send languages or mark either part saved after profile rejection", async () => {
    const api = port(); api.putProfile.mockResolvedValue(failure);
    expect(await saveProfileParts({ profile: {}, languages }, api)).toEqual({ kind: "failed", part: "profile", failure });
    expect(api.putLanguages).not.toHaveBeenCalled();
  });
  it("returns only the saved profile after a definite language rejection", async () => {
    const api = port(); api.putLanguages.mockResolvedValue(failure);
    expect(await saveProfileParts({ profile: {}, languages }, api)).toEqual({ kind: "partial", profile, failure });
    expect(api.putLanguages).toHaveBeenCalledTimes(1);
  });
  it("reports language-only rejection without claiming a profile save", async () => {
    const api = port(); api.putLanguages.mockResolvedValue(failure);
    expect(await saveProfileParts({ languages }, api)).toEqual({ kind: "failed", part: "languages", failure });
  });
  it.each(["no_response", "server_error", "unrecognized_response"] as const)("treats %s as uncertain, never retrying", async reason => {
    const uncertain: ProfileFailure = { ok: false, reason, reference: {} };
    const api = port(); api.putProfile.mockResolvedValue(uncertain);
    expect(await saveProfileParts({ profile: {}, languages }, api)).toEqual({ kind: "uncertain", part: "profile", failure: uncertain });
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putLanguages).not.toHaveBeenCalled();
    api.putProfile.mockResolvedValue({ ok: true, data: profile });
    api.putLanguages.mockResolvedValue(uncertain);
    expect(await saveProfileParts({ profile: {}, languages }, api)).toEqual({ kind: "uncertain", part: "languages", profile, failure: uncertain });
    expect(api.putLanguages).toHaveBeenCalledTimes(1);
  });
});
