import { afterEach, describe, expect, it, vi } from "vitest";
import { backendCheck } from "./backend-check";

const env = { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 };
const session = { accessToken: "fixture-access", cookies: ["next-auth.session-token=encrypted; HttpOnly; Path=/"] };
afterEach(() => vi.unstubAllGlobals());

describe("sanitized authentication diagnostics", () => {
  it("identifies unusable frontend credentials without calling Go", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await backendCheck(env, async () => ({ accessToken: null, cookies: session.cookies }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated", diagnostic: "frontend_session_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual(session.cookies);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    [{ error: "unauthorized", code: "unauthenticated" }, "backend_token_rejected"],
    [{ error: "unauthenticated", code: "unauthenticated" }, "backend_user_not_found"],
    [{ error: "unknown", code: "unauthenticated" }, "backend_auth_unknown"],
    [{ error: "unauthenticated", code: "wrong" }, "backend_auth_unknown"],
    [{ error: "unauthenticated", code: "unauthenticated", private: "fixture-sensitive" }, "backend_auth_unknown"],
    [null, "backend_auth_unknown"],
  ])("allowlists exact upstream envelopes only (%j)", async (body, diagnostic) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status: 401, headers: { "www-authenticate": "fixture-private-header", "set-cookie": "upstream=private" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await backendCheck(env, async () => session);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated", diagnostic });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual(session.cookies);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/me/company");
  });
  it.each(["not-json", JSON.stringify({ error: "unauthenticated", code: "unauthenticated" }) + " ".repeat(600)])("falls back for malformed or oversized bodies", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 401 })));
    const response = await backendCheck(env, async () => session);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated", diagnostic: "backend_auth_unknown" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
