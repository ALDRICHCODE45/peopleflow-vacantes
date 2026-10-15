import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { backendCheck } from "./backend-check";

const env = { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 };
const privateSession = { accessToken: "synthetic-access", cookies: ["session=encrypted; HttpOnly; Path=/"] };
afterEach(() => vi.unstubAllGlobals());

describe("private backend diagnostic", () => {
  it("uses the fixed endpoint, access bearer, no-store and rejects redirects; redacts company data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ company_id: "private-id", role: "owner", company: { id: "private-id", name: "private-name", rfc: "private-rfc", industry_id: "private-industry", status: "active" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await backendCheck(env, async () => privateSession);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.getSetCookie()).toEqual(privateSession.cookies);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/me/company");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-access");
    expect(init.body).toBeUndefined();
  });
  it("does not call Go without a usable session", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await backendCheck(env, async () => ({ accessToken: null, cookies: [] }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated", diagnostic: "frontend_session_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([[401, 401, "unauthenticated"], [404, 404, "not_found"], [500, 502, "backend_unavailable"], [302, 502, "backend_unavailable"]])("sanitizes upstream %s and persists only session cookies", async (upstream, status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-upstream-body", { status: upstream, headers: { location: "https://untrusted.example", "set-cookie": "upstream=private", "www-authenticate": "private" } })));
    const response = await backendCheck(env, async () => privateSession);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code, ...(upstream === 401 ? { diagnostic: "backend_auth_unknown" } : {}) });
    expect(response.headers.getSetCookie()).toEqual(privateSession.cookies);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("sanitizes network failures without losing renewed cookies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-access secret")));
    const response = await backendCheck(env, async () => privateSession);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, code: "backend_unavailable" });
    expect(response.headers.getSetCookie()).toEqual(privateSession.cookies);
  });
  it("rejects a malformed success instead of claiming Go acceptance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const response = await backendCheck(env, async () => privateSession);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_backend_response" });
  });
});
