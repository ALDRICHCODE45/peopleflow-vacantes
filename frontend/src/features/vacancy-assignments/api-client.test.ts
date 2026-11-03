import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8081", apiTimeoutMs: 1000 } }));
import { getHistory } from "./api-client";
import { createFixtureClient } from "./client";
afterEach(() => vi.unstubAllGlobals());
function reply(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
it("reads own history through guarded bearer GET and opaque cursor", async () => {
  const body = await createFixtureClient().getHistory();
  body.items[0].started_at = "2026-10-15T00:07:43.276165+00:00";
  const fetch = reply(body);
  expect(await getHistory({ token: " token ", cursor: "opaque+/=" })).toEqual({ ok: true, data: body });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("http://localhost:8081/v2/me/vacancy-assignments/history?cursor=opaque%2B%2F%3D");
  expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
});
it.each([[401, "anything", "unauthenticated"], [400, "invalid_cursor", "invalid_cursor"], [400, "other", "read_failed"], [403, "invalid_cursor", "read_failed"], [500, "private", "read_failed"]])("maps %s %s without leaking backend text", async (status, code, expected) => {
  reply({ code, error: "private backend text" }, Number(status));
  expect(await getHistory({ token: "token" })).toEqual({ ok: false, code: expected, status });
});
it("rejects malformed success and guards empty session before transport", async () => {
  const fetch = reply({ items: [], next_cursor: null, candidate: {} });
  expect(await getHistory({ token: "token" })).toEqual({ ok: false, code: "read_failed" });
  fetch.mockClear();
  expect(await getHistory({ token: " " })).toEqual({ ok: false, code: "unauthenticated", status: 401 });
  expect(fetch).not.toHaveBeenCalled();
});
