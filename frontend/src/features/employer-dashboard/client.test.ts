import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { getDashboardSection, listDashboard } from "./client";
import { dashboardApplications, dashboardCandidates, dashboardDeliveries, dashboardVacancies } from "./detail/test-fixtures";
import { attention, origin, pipeline, recent, summary, vacancies } from "./test-fixtures";

afterEach(() => vi.unstubAllGlobals());
const ok = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));

it.each([
  ["summary", summary()], ["attention", attention()], ["pipeline", pipeline()], ["vacancies", vacancies()], ["recent", recent()], ["origin", origin()],
] as const)("reads %s with an authenticated absolute GET, no-store, accept and redirect guards", async (section, body) => {
  const fetch = ok(body); vi.stubGlobal("fetch", fetch);
  expect(await getDashboardSection(" token ", section, 30)).toEqual({ ok: true, data: body });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`http://localhost:8080/v2/me/company/dashboard/${section}?window=30`);
  expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "GET" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
  expect(new Headers(init.headers).get("accept")).toBe("application/json");
});

it("never calls the old aggregate route", async () => {
  const fetch = ok(origin(90)); vi.stubGlobal("fetch", fetch);
  await getDashboardSection("x", "origin", 90);
  expect(String(fetch.mock.calls[0][0])).toBe("http://localhost:8080/v2/me/company/dashboard/origin?window=90");
});

it("sends only an allowed window and never builds a path from an unknown section", async () => {
  const fetch = ok(summary()); vi.stubGlobal("fetch", fetch);
  await getDashboardSection("x", "summary", 14 as never);
  expect(String(fetch.mock.calls[0][0])).toBe("http://localhost:8080/v2/me/company/dashboard/summary?window=30");
  expect(await getDashboardSection("x", "../metrics" as never, 30)).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([undefined, null, "", "   ", 123])("rejects token %s before transport", async token => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await getDashboardSection(token as string, "summary", 30)).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([null, { ...summary(), extra: true }])("rejects malformed data %#", async body => {
  vi.stubGlobal("fetch", ok(body));
  expect(await getDashboardSection("x", "summary", 30)).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } });
});

it.each([401, 403, 422, 500])("preserves HTTP %s and the error envelope without automatic retry", async status => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private", code: "forbidden" }), { status })); vi.stubGlobal("fetch", fetch);
  expect(await getDashboardSection("x", "attention", 30)).toMatchObject({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { code: "forbidden" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  ["candidates", dashboardCandidates()], ["deliveries", dashboardDeliveries()], ["vacancies", dashboardVacancies()], ["applications", dashboardApplications()],
] as const)("reads the %s list (§5) with its query, the page size and the cursor, tagged with its kind", async (kind, body) => {
  const fetch = ok(body); vi.stubGlobal("fetch", fetch);
  expect(await listDashboard(" token ", kind, new URLSearchParams({ window: "90", vacancy_id: "v" }), "c2")).toEqual({ ok: true, data: { kind, page: body } });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`http://localhost:8080/v2/me/company/dashboard/lists/${kind}?window=90&vacancy_id=v&limit=50&cursor=c2`);
  expect(init).toMatchObject({ cache: "no-store", redirect: "error", method: "GET" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
});

it("never builds a list path from an unknown kind and rejects a page that is not the list", async () => {
  const fetch = ok(dashboardCandidates()); vi.stubGlobal("fetch", fetch);
  expect(await listDashboard("x", "../summary" as never, new URLSearchParams())).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await listDashboard("", "candidates", new URLSearchParams())).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal("fetch", ok({ ...dashboardCandidates(), definitions_version: undefined }));
  expect(await listDashboard("x", "candidates", new URLSearchParams())).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it("reads the vacancies list's positions over every filtered row and fails closed without them", async () => {
  const body = dashboardVacancies({ positions: { covered: 2, required: 14 } });
  vi.stubGlobal("fetch", ok(body));
  expect(await listDashboard("x", "vacancies", new URLSearchParams())).toMatchObject({ ok: true, data: { kind: "vacancies", page: { positions: { covered: 2, required: 14 } } } });
  for (const positions of [undefined, null, { covered: 2 }, { covered: -1, required: 14 }, { covered: 1.5, required: 14 }]) {
    vi.stubGlobal("fetch", ok({ ...body, positions }));
    expect(await listDashboard("x", "vacancies", new URLSearchParams())).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  }
});
