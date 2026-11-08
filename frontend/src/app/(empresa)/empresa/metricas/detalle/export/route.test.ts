// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 200 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { dynamic, GET, runtime } from "./route";

const recruiter = "10000000-0000-4000-8000-000000000005";
const CSV = "﻿Vacante,Resultado\r\nCoordinador de logística,late\r\n";
const upstreamCsv = () => new Response(CSV, { headers: {
  "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="metricas-deliveries-2026-08-01-2026-10-31.csv"', "set-cookie": "private=1", "x-secret": "no",
} });
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getActionAccessToken).mockReset().mockResolvedValue(" private-token ");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const get = (search: string, headers: HeadersInit = {}) => GET(new Request(`http://localhost/empresa/metricas/detalle/export?${search}`, { headers }));
const upstreamError = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });

it("is dynamic and runs on the Node runtime", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(runtime).toBe("nodejs");
});

it("streams the kind's API export with the session token, the validated query and only the CSV headers", async () => {
  fetchMock.mockResolvedValue(upstreamCsv());
  const response = await get(`kind=deliveries&from=2026-08-01&to=2026-10-31&recruiter_id=${recruiter}&result=late,late&sort=title&cursor=abc&limit=5&token=x`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="metricas-deliveries-2026-08-01-2026-10-31.csv"');
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("x-secret")).toBe(false);
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer())).toBe(CSV);
  const [url, init] = fetchMock.mock.calls[0];
  const called = new URL(String(url));
  expect(called.pathname).toBe("/v2/me/company/metrics/deliveries/export");
  expect(called.search).toBe(`?from=2026-08-01&to=2026-10-31&recruiter_id=${recruiter}&result=late&sort=title`);
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("sends the default period when the link has none", async () => {
  fetchMock.mockResolvedValue(upstreamCsv());
  await get("kind=placements&held=false");
  expect(new URL(String(fetchMock.mock.calls[0][0])).search).toBe("?from=2026-08-10&to=2026-11-07&held=false");
});

it("explains a too-large export in Spanish, with the counts and without the backend text", async () => {
  fetchMock.mockResolvedValue(upstreamError(422, "metrics_export_too_large", { row_count: 61234, limit: 50000 }));
  const response = await get("kind=vacancies");
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body).toEqual({ error: "metrics_export_too_large", code: "metrics_export_too_large", message: "Son más de 50,000 filas: acota el periodo o los filtros", row_count: 61234, limit: 50000 });
  expect(JSON.stringify(body)).not.toContain("private backend message");
});

it.each([
  [401, "unauthenticated", 401], [403, "forbidden", 403], [422, "invalid_filter", 422], [500, "internal_error", 502],
] as const)("maps an API %s %s to %s", async (status, code, expected) => {
  fetchMock.mockResolvedValue(upstreamError(status, code));
  const response = await get("kind=deliveries");
  expect(response.status).toBe(expected);
  expect(JSON.stringify(await response.json())).not.toContain("private backend message");
});

it("refuses without a session, for a kind without a list and for a cross-site request, without calling the API", async () => {
  expect((await get("kind=candidates")).status).toBe(404);
  expect((await get("kind=nope")).status).toBe(404);
  expect((await get("kind=deliveries", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect((await get("kind=deliveries")).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
