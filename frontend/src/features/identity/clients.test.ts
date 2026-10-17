import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
import { loadMe } from "./me-client";
import { createCandidateAccount } from "./candidate-account-client";
const user = { id: "a12b3456-1234-4234-8234-123456789abc", email: "ana@example.com", full_name: "Ana Pérez" };
const candidate = { role: "candidate", user };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe("identity transport", () => {
  it.each([candidate, { role: "recruiter", user }, { role: null, user: null }])("strictly reads %j", async data => {
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadMe({ token: "access" })).toEqual({ ok: true, data });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v2/me");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(init.headers.get("authorization")).toBe("Bearer access");
  });
  it.each([{ role: null, user }, { role: "candidate", user: null }, { ...candidate, extra: true }, { role: "owner", user }, { role: "candidate", user: { ...user, extra: true } }, { role: "candidate", user: { ...user, email: 2 } }])("rejects inconsistent/unknown data %j", async data => {
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadMe({ token: "access" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it.each([200, 201])("creates only the name, accepts %i", async status => {
    fetchMock.mockResolvedValue(Response.json(candidate, { status }));
    expect(await createCandidateAccount({ token: "access", body: { full_name: "  Ana Pérez  " } })).toEqual({ ok: true, data: candidate });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ full_name: "Ana Pérez" }) });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/v2/me/candidate-account");
  });
  it.each([{ full_name: "Ana", email: "forged@example.com" }, { full_name: " " }, { full_name: "A" }, { full_name: "x".repeat(121) }])("rejects invalid input before requesting %j", async body => {
    expect(await createCandidateAccount({ token: "access", body })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["", "bad token", "\naccess"])('rejects unusable token %j', async token => {
    expect(await loadMe({ token })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ role: null, user: null }, { role: "recruiter", user }])("never accepts a non-candidate creation result", async data => {
    fetchMock.mockResolvedValue(Response.json(data, { status: 201 }));
    expect(await createCandidateAccount({ token: "access", body: { full_name: "Ana" } })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it("decodes only the exact error envelope", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "private detail", code: "email_in_use", extra: true }, { status: 409 }));
    const result = await createCandidateAccount({ token: "access", body: { full_name: "Ana" } });
    expect(result).not.toHaveProperty("envelope");
  });
});
