// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 200 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import * as route from "./route";
import { dynamic, POST, runtime } from "./route";

const vacancy = "30000000-0000-4000-8000-000000000001";
const CSV = "﻿Vacante,Resultado\r\nCoordinador de logística,overdue\r\n";
const upstreamCsv = () => new Response(CSV, { headers: {
  "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="dashboard-deliveries-2026-10-10-2026-11-08.csv"', "set-cookie": "private=1", "x-secret": "no",
} });
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getActionAccessToken).mockReset().mockResolvedValue(" private-token ");
});
afterEach(() => { vi.unstubAllGlobals(); });
/** `kind=…` is the path segment, as the browser button builds it; the rest stays in the query. */
const post = (search: string, headers: HeadersInit = {}) => {
  const query = new URLSearchParams(search);
  const kind = query.get("kind") ?? "";
  query.delete("kind");
  return POST(new Request(`http://localhost/api/company/dashboard/${encodeURIComponent(kind)}/export?${query}`, { method: "POST", headers }), { params: Promise.resolve({ kind }) });
};
const upstreamError = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });

it("is dynamic and runs on the Node runtime", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(runtime).toBe("nodejs");
});

it("streams the kind's dashboard export with the session token, the validated query with its window and only the CSV headers", async () => {
  fetchMock.mockResolvedValue(upstreamCsv());
  const response = await post(`kind=deliveries&window=90&state=overdue&state=late&vacancy_id=${vacancy}&sort=title&cursor=abc&limit=5&recruiter_id=x`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="dashboard-deliveries-2026-10-10-2026-11-08.csv"');
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("x-secret")).toBe(false);
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer())).toBe(CSV);
  const [url, init] = fetchMock.mock.calls[0];
  const called = new URL(String(url));
  expect(called.pathname).toBe("/v2/me/company/dashboard/lists/deliveries/export");
  expect(called.search).toBe(`?window=90&state=overdue&vacancy_id=${vacancy}&sort=title`);
  expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it.each([
  ["candidates", "in_process=true&on=2026-11-01&stage_kind=screening&channel=portal", "?window=30&in_process=true&on=2026-11-01&stage_kind=screening"],
  ["vacancies", "status=published&sort=positions_open", "?window=30&status=published&sort=positions_open"],
  ["applications", "window=7&from=2026-11-03&to=2026-11-03&channel=manual&stalled=true", "?window=7&from=2026-11-03&to=2026-11-03&channel=manual"],
])("exports the %s list with its own filters only and the default window when none is given", async (kind, query, search) => {
  fetchMock.mockResolvedValue(upstreamCsv());
  expect((await post(`kind=${kind}&${query}`)).status).toBe(200);
  const called = new URL(String(fetchMock.mock.calls[0][0]));
  expect(called.pathname).toBe(`/v2/me/company/dashboard/lists/${kind}/export`);
  expect(called.search).toBe(search);
});

it("takes the kind from the path, never from a kind in the query", async () => {
  fetchMock.mockResolvedValue(upstreamCsv());
  await POST(new Request("http://localhost/api/company/dashboard/vacancies/export?kind=deliveries&window=30", { method: "POST" }), { params: Promise.resolve({ kind: "vacancies" }) });
  const called = new URL(String(fetchMock.mock.calls[0][0]));
  expect(called.pathname).toBe("/v2/me/company/dashboard/lists/vacancies/export");
  expect(called.searchParams.has("kind")).toBe(false);
});

it("explains a too-large export in Spanish, with the counts and without the backend text", async () => {
  fetchMock.mockResolvedValue(upstreamError(422, "metrics_export_too_large", { row_count: 61234, limit: 50000 }));
  const response = await post("kind=candidates&window=30");
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body).toEqual({ error: "metrics_export_too_large", code: "metrics_export_too_large", message: "Son más de 50,000 filas: acota los filtros", row_count: 61234, limit: 50000 });
  expect(JSON.stringify(body)).not.toContain("private backend message");
});

it.each([
  [401, "unauthenticated", 401], [403, "forbidden", 403], [422, "invalid_filter", 422], [500, "internal_error", 502],
] as const)("maps an API %s %s to %s", async (status, code, expected) => {
  fetchMock.mockResolvedValue(upstreamError(status, code));
  const response = await post("kind=deliveries");
  expect(response.status).toBe(expected);
  expect(JSON.stringify(await response.json())).not.toContain("private backend message");
});

it("refuses without a session, for an unknown kind and for a cross-origin request, without calling the API", async () => {
  expect((await post("kind=nope")).status).toBe(404);
  expect((await post("kind=placements")).status).toBe(404);
  expect((await post("kind=..%2Fsummary")).status).toBe(404);
  expect((await post("kind=deliveries", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await post("kind=deliveries", { origin: "https://evil.test" })).status).toBe(403);
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect((await post("kind=deliveries")).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

// Like the audit and metrics exports: a POST, so SameSite=Lax keeps the session cookie off cross-site navigations.
it("answers only POST: a cross-site link or <img> cannot trigger an export", () => {
  expect(Object.keys(route)).not.toContain("GET");
  expect(typeof POST).toBe("function");
});
