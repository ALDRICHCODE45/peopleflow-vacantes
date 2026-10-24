import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { getDashboard } from "./client";
import { dashboard } from "./test-fixtures";
afterEach(() => vi.unstubAllGlobals());
it("uses authenticated absolute v2 GET, no-store, accept and redirect guards", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard))); vi.stubGlobal("fetch", fetch);
  expect(await getDashboard({ token: " token " })).toEqual({ ok: true, data: dashboard });
  const [url, init] = fetch.mock.calls[0]; expect(url).toBe("http://localhost:8080/v2/me/company/dashboard");
  expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "GET" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token"); expect(new Headers(init.headers).get("accept")).toBe("application/json"); expect(init.body).toBeUndefined();
});
it.each([undefined, null, "", "   ", 123])("rejects token %s before transport", async token => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await getDashboard({ token: token as string })).toMatchObject({ ok: false, error: { kind: "missing_token" } }); expect(fetch).not.toHaveBeenCalled(); });
it.each([201, 204])("rejects unexpected success status %s", async status => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(dashboard), { status }))); expect(await getDashboard({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
it.each([null, { ...dashboard, extra: true }, { ...dashboard, recent: null }])("rejects malformed data %#", async body => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))); expect(await getDashboard({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
it.each([401, 403, 404, 409, 500])("preserves HTTP %s for the action without automatic retry", async status => { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private", code: "forbidden" }), { status })); vi.stubGlobal("fetch", fetch); expect(await getDashboard({ token: "x" })).toMatchObject({ ok: false, error: { kind: "status", status, retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1); });
it("classifies a network failure", async () => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private"))); expect(await getDashboard({ token: "x" })).toMatchObject({ ok: false, error: { kind: "network", retryable: false } }); });
