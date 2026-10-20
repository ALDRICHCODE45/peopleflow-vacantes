import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
import { getProfile, putProfile, getProfileLanguages, putProfileLanguages } from "./profile-client";
const profile = { user_id: "11111111-1111-4111-8111-111111111111", location: null, salary_currency: "MXN", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("authenticated candidate profile transport", () => {
  it("uses the guarded no-store transport and fixed routes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile), { status: 200 })); vi.stubGlobal("fetch", fetch);
    expect((await getProfile({ token: "test-token" })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/me/profile/", expect.objectContaining({ method: "GET", cache: "no-store", redirect: "error" }));
    const options = fetch.mock.calls[0][1];
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer test-token");
    fetch.mockResolvedValue(new Response(JSON.stringify(profile), { status: 200 }));
    await putProfile({ token: "test-token", body: { location: { country: "MX", state: "01" } } });
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ location: { country: "MX", state: "01" } }));
    fetch.mockResolvedValue(new Response(JSON.stringify({ languages: [] }), { status: 200 }));
    expect((await getProfileLanguages({ token: "test-token" })).ok).toBe(true);
    expect(fetch.mock.calls[2][0]).toBe("https://api.example.test/me/profile/languages/");
  });
  it("rejects invalid tokens and invalid bodies without a request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await getProfile({ token: "bad token" })).ok).toBe(false);
    expect((await putProfile({ token: "test", body: { location: { country: "MX", postal_code: null } } })).ok).toBe(false);
    expect((await putProfileLanguages({ token: "test", body: { languages: [{ name: "English", level: "" }] } })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sanitizes location errors and does not retry writes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private message", code: "invalid_location", details: [{ field: "location.state", reason: "unknown" }] }), { status: 422 })); vi.stubGlobal("fetch", fetch);
    expect(await putProfile({ token: "test", body: { location: { country: "MX", state: "99" } } })).toEqual({ ok: false, reason: "invalid_location", reference: { status: 422, code: "invalid_location" }, locationIssues: [{ field: "state", reason: "unknown" }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a missing profile from an unknown response or lost connection", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "missing", code: "not_found" }), { status: 404 })); vi.stubGlobal("fetch", fetch);
    expect(await getProfile({ token: "test" })).toMatchObject({ ok: false, reason: "not_found" });
    fetch.mockResolvedValue(new Response(JSON.stringify({ ...profile, city: "legacy" }), { status: 200 }));
    expect(await getProfile({ token: "test" })).toMatchObject({ ok: false, reason: "unrecognized_response" });
    fetch.mockRejectedValue(new Error("private exception"));
    expect(await putProfile({ token: "test", body: {} })).toEqual({ ok: false, reason: "no_response", reference: {} });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
