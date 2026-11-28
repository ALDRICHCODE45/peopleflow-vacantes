import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
import { createEmployerAccount } from "./employer-account-client";

const user = { id: "a12b3456-1234-4234-8234-123456789abc", email: "andrea@altavista.mx", full_name: "Andrea Salinas" };
const recruiter = { role: "recruiter", user };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /v2/me/employer-account (L8/L12)", () => {
  it.each([201, 200])("sends only the normalized name and accepts %i (200 = already recruiter on retry)", async status => {
    fetchMock.mockResolvedValue(Response.json(recruiter, { status }));
    expect(await createEmployerAccount({ token: "access", body: { full_name: "  Andrea   Salinas " } })).toEqual({ ok: true, data: recruiter });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v2/me/employer-account");
    expect(init).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ full_name: "Andrea Salinas" }) });
    expect(init.headers.get("authorization")).toBe("Bearer access");
  });

  it("treats an uncontracted 2xx as unconfirmed", async () => {
    fetchMock.mockResolvedValue(Response.json(recruiter, { status: 202 }));
    expect(await createEmployerAccount({ token: "access", body: { full_name: "Andrea" } })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it.each([{ role: "candidate", user }, { role: null, user: null }])("never accepts a non-recruiter result %j", async data => {
    fetchMock.mockResolvedValue(Response.json(data, { status: 201 }));
    expect(await createEmployerAccount({ token: "access", body: { full_name: "Andrea" } })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it.each([{ full_name: "Andrea", email: "forged@example.com" }, { full_name: "A" }, { full_name: "x".repeat(121) }, {}])("rejects invalid input before requesting %j", async body => {
    expect(await createEmployerAccount({ token: "access", body })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "bad token"])("rejects unusable token %j", async token => {
    expect(await createEmployerAccount({ token, body: { full_name: "Andrea" } })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[409, "account_exists"], [409, "email_in_use"], [422, "email_not_verified"], [503, "identity_unavailable"]])("keeps the %i %s envelope for classification", async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ error: "x", code }, { status }));
    expect(await createEmployerAccount({ token: "access", body: { full_name: "Andrea" } })).toMatchObject({ ok: false, error: { status }, envelope: { code } });
  });
});
