import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { listStakeholderVacancies } from "./client";
import { listWire } from "./test-fixtures";

function response(body: unknown, status = 200) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => vi.unstubAllGlobals());

it("reads the v2 stakeholder list with the Bearer token, the default page and no rewriting of the envelope", async () => {
  const fetch = response(listWire());
  expect(await listStakeholderVacancies({ token: " secret " })).toEqual({ ok: true, data: listWire() });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("http://localhost:8080/v2/me/company/stakeholder/vacancies");
  expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer secret" });
});
it("sends the opaque cursor encoded and the limit", async () => {
  const fetch = response({ items: [], next_cursor: null });
  const cursor = " a+/=&?ñ ";
  await listStakeholderVacancies({ token: "x", cursor, limit: 50 });
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/v2/me/company/stakeholder/vacancies?limit=50&cursor=${new URLSearchParams({ cursor }).toString().slice(7)}`);
});
it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: 4 as unknown as string }])("sends nothing for the invalid input %j", async input => {
  const fetch = response(listWire());
  expect(await listStakeholderVacancies({ token: "x", ...input })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("sends nothing without a token", async () => {
  const fetch = response(listWire());
  expect(await listStakeholderVacancies({ token: " " })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects a malformed body as an invalid response", async () => {
  response({ items: [{ id: "x" }], next_cursor: null });
  expect(await listStakeholderVacancies({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it("keeps the error envelope of a 403 (a recruiter is not allowed)", async () => {
  response({ error: "forbidden", code: "forbidden" }, 403);
  expect(await listStakeholderVacancies({ token: "x" })).toMatchObject({ ok: false, error: { kind: "status", status: 403 }, envelope: { code: "forbidden" } });
});
