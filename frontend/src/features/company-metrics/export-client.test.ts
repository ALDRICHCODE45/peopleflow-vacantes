import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { exportDetail } from "./export-client";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const headersOf = (init: RequestInit) => new Headers(init.headers);
const csv = (headers: Record<string, string> = {}) => new Response("﻿Vacante\r\n", {
  headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="metricas-deliveries.csv"', ...headers },
});
const query = () => new URLSearchParams({ from: "2026-08-01", to: "2026-10-31", result: "late" });

it("GETs the kind's export with the query and hands back the CSV stream with its disposition", async () => {
  fetchMock.mockResolvedValue(csv());
  const result = await exportDetail(" t ", "deliveries", query());
  if (!result.ok) throw new Error("expected ok");
  expect(result.data.contentType).toBe("text/csv; charset=utf-8");
  expect(result.data.disposition).toBe('attachment; filename="metricas-deliveries.csv"');
  // The UTF-8 BOM (Excel es-MX) must survive byte for byte.
  expect([...new Uint8Array(await new Response(result.data.body).arrayBuffer()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const [url, init] = fetchMock.mock.calls[0];
  const called = new URL(url);
  expect(called.origin).toBe("http://localhost:8080");
  expect(called.pathname).toBe("/v2/me/company/metrics/deliveries/export");
  expect(called.search).toBe("?from=2026-08-01&to=2026-10-31&result=late");
  expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(headersOf(init).get("authorization")).toBe("Bearer t");
  expect(headersOf(init).get("accept")).toBe("text/csv");
});

it("streams the CSV opaquely: the extra «Tipo de proceso» column and every cell arrive byte for byte, for any kind", async () => {
  const body = "\uFEFFID vacante,Vacante,Tipo de proceso\r\nd1,\"Supervisor, planta\",replacement\r\n";
  for (const kind of ["deliveries", "placements", "reassignments", "candidates", "applications", "vacancies"] as const) {
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="metricas-${kind}.csv"` } }));
    const result = await exportDetail("t", kind, query());
    if (!result.ok) throw new Error("expected ok");
    expect([...new Uint8Array(await new Response(result.data.body).arrayBuffer())]).toEqual([...new TextEncoder().encode(body)]);
  }
});

it("refuses a missing token, an unknown kind and a paged query before any request", async () => {
  expect(await exportDetail(" ", "deliveries", query())).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(await exportDetail("t", "recruiters" as never, query())).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await exportDetail("t", "toString" as never, query())).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await exportDetail("t", "deliveries", new URLSearchParams({ cursor: "abc" }))).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("decodes the 422 metrics_export_too_large counters from the envelope", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "private", code: "metrics_export_too_large", row_count: 61234, limit: 50000 }, { status: 422 }));
  expect(await exportDetail("t", "vacancies", query())).toMatchObject({ ok: false, error: { kind: "status", status: 422 }, envelope: { code: "metrics_export_too_large", row_count: 61234, limit: 50000 } });
});

it.each([
  ["a JSON 200", { "content-type": "application/json" }],
  ["a missing attachment disposition", { "content-disposition": "inline" }],
  ["a look-alike disposition", { "content-disposition": "attachments; filename=a.csv" }],
])("treats %s as an invalid response and never streams it", async (_name, headers) => {
  fetchMock.mockResolvedValue(csv(headers));
  expect(await exportDetail("t", "deliveries", query())).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it("reports a transport failure as no response", async () => {
  fetchMock.mockRejectedValue(new TypeError("offline"));
  expect(await exportDetail("t", "deliveries", query())).toMatchObject({ ok: false, error: { kind: "network" } });
});
