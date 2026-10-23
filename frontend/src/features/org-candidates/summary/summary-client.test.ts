import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { getCandidatesSummary } from "./summary-client";
import { summary } from "./test-fixtures";
afterEach(() => vi.unstubAllGlobals());
it("uses the fixed absolute v2 GET with auth, accept, no-store and redirect guards", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(summary), { headers: { "cache-control": "no-store" } }));
  vi.stubGlobal("fetch", fetch);
  expect(await getCandidatesSummary({ token: " token " })).toEqual({ ok: true, data: summary });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("http://localhost:8080/v2/me/company/candidates/summary");
  expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "GET" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
  expect(new Headers(init.headers).get("accept")).toBe("application/json");
  expect(init.body).toBeUndefined();
});
it.each([undefined, null, "", "   ", 123])("rejects token %s before transport", async token => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await getCandidatesSummary({ token: token as string })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([201, 204])("rejects unexpected success status %s", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(summary), { status })));
  expect(await getCandidatesSummary({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([{ ...summary, total: 9 }, { ...summary, extra: true }, { total: -1 }, null])("rejects malformed or inconsistent data", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  expect(await getCandidatesSummary({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([401, 403, 404, 500])("preserves HTTP %s classification for the action", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "raw message", code: "forbidden" }), { status })));
  expect(await getCandidatesSummary({ token: "x" })).toMatchObject({ ok: false, error: { kind: "status", status, retryable: false } });
});
it("classifies a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private")));
  expect(await getCandidatesSummary({ token: "x" })).toMatchObject({ ok: false, error: { kind: "network", retryable: false } });
});
