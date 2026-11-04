import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { exportAuditCsv, getAuditActors, getAuditTypes, getAuditVacancies, listAuditEvents } from "./client";
import { anaId, auditActors, auditPage, auditTypes, auditVacancies, vacancyId } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const headersOf = (init: RequestInit) => new Headers(init.headers);

it("authenticates a no-store GET and encodes every filter, repeating event_type", async () => {
  fetchMock.mockResolvedValue(Response.json(auditPage()));
  const result = await listAuditEvents({
    token: " token ", cursor: "a+/=", limit: 25,
    filters: { actor_id: anaId, event_type: ["SessionStarted", "SessionEnded"], category: "session", vacancy_id: vacancyId, from: "2026-11-01", to: "2026-11-04" },
  });
  expect(result).toEqual({ ok: true, data: auditPage() });
  const [url, init] = fetchMock.mock.calls[0];
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/v2/me/company/audit-events");
  expect(parsed.searchParams.getAll("event_type")).toEqual(["SessionStarted", "SessionEnded"]);
  expect(Object.fromEntries([...parsed.searchParams].filter(([key]) => key !== "event_type"))).toEqual({
    actor_id: anaId, category: "session", vacancy_id: vacancyId, from: "2026-11-01", to: "2026-11-04", limit: "25", cursor: "a+/=",
  });
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(headersOf(init).get("authorization")).toBe("Bearer token");
});

it("defaults to the contract page size and omits an absent cursor", async () => {
  fetchMock.mockResolvedValue(Response.json(auditPage()));
  await listAuditEvents({ token: "t" });
  const parsed = new URL(fetchMock.mock.calls[0][0]);
  expect(parsed.searchParams.get("limit")).toBe("50");
  expect(parsed.searchParams.has("cursor")).toBe(false);
});

it("guards a missing token and an out-of-contract limit before any request", async () => {
  expect(await listAuditEvents({ token: " " })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(await listAuditEvents({ token: "t", limit: 0 })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await listAuditEvents({ token: "t", limit: 101 })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await listAuditEvents({ token: "t", limit: 1.5 })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects response drift instead of rendering it", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...auditPage(), extra: true }));
  expect(await listAuditEvents({ token: "t" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  fetchMock.mockResolvedValue(Response.json({ items: [{ id: "x" }], total: 1, next_cursor: null }));
  expect(await listAuditEvents({ token: "t" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it.each([
  [403, { error: "private", code: "forbidden" }],
  [422, { error: "private", code: "invalid_filter", fields: [{ field: "from", code: "range" }] }],
  [400, { error: "private", code: "invalid_cursor" }],
])("decodes the %s envelope", async (status, body) => {
  fetchMock.mockResolvedValue(Response.json(body, { status }));
  expect(await listAuditEvents({ token: "t" })).toMatchObject({ ok: false, error: { kind: "status", status }, envelope: { code: body.code } });
});

it.each([
  ["types", getAuditTypes, "/v2/me/company/audit-events/types", { items: auditTypes }],
  ["actors", getAuditActors, "/v2/me/company/audit-events/actors", { items: auditActors }],
  ["vacancies", getAuditVacancies, "/v2/me/company/audit-events/vacancies", { items: auditVacancies }],
] as const)("reads the %s catalog over authenticated no-store GET and rejects drift", async (_name, read, path, body) => {
  fetchMock.mockResolvedValue(Response.json(body));
  expect(await read(" t ")).toEqual({ ok: true, data: body });
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toBe(path);
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(headersOf(init).get("authorization")).toBe("Bearer t");
  fetchMock.mockResolvedValue(Response.json({ ...body, extra: 1 }));
  expect(await read("t")).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  fetchMock.mockClear();
  expect(await read("")).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

const csv = (headers: Record<string, string> = {}) => new Response("\ufeffoccurred_at\r\n", {
  headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"', ...headers },
});
const range = { from: "2026-11-01", to: "2026-11-04" };

it("POSTs the JSON body and hands back the CSV stream with its disposition", async () => {
  fetchMock.mockResolvedValue(csv());
  const result = await exportAuditCsv("t", { ...range, event_types: ["SessionEnded"], actor_id: anaId });
  if (!result.ok) throw new Error("expected ok");
  expect(result.data.contentType).toBe("text/csv; charset=utf-8");
  expect(result.data.disposition).toBe('attachment; filename="auditoria-2026-11-04.csv"');
  // The UTF-8 BOM (Excel es-MX) must survive byte for byte.
  expect([...new Uint8Array(await new Response(result.data.body).arrayBuffer()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toBe("/v2/me/company/audit-events/export");
  expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
  expect(JSON.parse(init.body)).toEqual({ ...range, event_types: ["SessionEnded"], actor_id: anaId });
  expect(headersOf(init).get("authorization")).toBe("Bearer t");
  expect(headersOf(init).get("content-type")).toBe("application/json");
});

it("refuses an invalid export body before any request", async () => {
  expect(await exportAuditCsv("t", { from: "2026-11-01" } as never)).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await exportAuditCsv("t", { from: "2025-01-01", to: "2026-11-04" })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await exportAuditCsv(" ", range)).toMatchObject({ ok: false, error: { kind: "missing_token" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("decodes the 422 audit_export_too_large counters from the envelope", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "private", code: "audit_export_too_large", row_count: 60123, limit: 50000 }, { status: 422 }));
  expect(await exportAuditCsv("t", range)).toMatchObject({ ok: false, error: { kind: "status", status: 422 }, envelope: { code: "audit_export_too_large", row_count: 60123, limit: 50000 } });
});

it.each([
  ["a JSON 200", { "content-type": "application/json" }],
  ["a missing attachment disposition", { "content-disposition": "inline" }],
  ["a look-alike disposition", { "content-disposition": "attachments; filename=a.csv" }],
])("treats %s as an invalid response and never streams it", async (_name, headers) => {
  fetchMock.mockResolvedValue(csv(headers));
  expect(await exportAuditCsv("t", range)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
