// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 200 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { dynamic, POST, runtime } from "./route";

const BOM_CSV = "\ufeffoccurred_at,event_type\r\n2026-11-04T17:03:12Z,SessionStarted\r\n";
const upstreamCsv = () => new Response(BOM_CSV, { headers: {
  "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"', "set-cookie": "private=1", "x-secret": "no",
} });
const range = { from: "2026-11-01", to: "2026-11-04" };
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockReset().mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const post = (body: unknown = range, headers: HeadersInit = {}) => POST(new Request("http://localhost/api/company/audit-events/export", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
}));
const upstreamError = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });

it("is dynamic and runs on the Node runtime", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(runtime).toBe("nodejs");
});

it("streams the API CSV with its disposition, no-store, and nothing else from upstream", async () => {
  fetchMock.mockResolvedValue(upstreamCsv());
  const response = await post({ ...range, event_types: ["SessionStarted"] });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="auditoria-2026-11-04.csv"');
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("x-secret")).toBe(false);
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer())).toBe(BOM_CSV);
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toBe("/v2/me/company/audit-events/export");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ ...range, event_types: ["SessionStarted"] });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("forwards only the contract keys: an unknown key is refused, not passed along", async () => {
  expect(await (await post({ ...range, role: "owner" })).json()).toMatchObject({ code: "invalid_filter", fields: [{ field: "role", code: "unknown" }] });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  ["a missing end", { from: "2026-11-01" }, [{ field: "to", code: "required" }]],
  ["more than 366 days", { from: "2025-01-01", to: "2026-11-04" }, [{ field: "from", code: "range" }]],
  ["an inverted range", { from: "2026-11-05", to: "2026-11-04" }, [{ field: "from", code: "range" }]],
])("answers 422 invalid_filter for %s without calling the API", async (_name, body, fields) => {
  const response = await post(body);
  expect(response.status).toBe(422);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "invalid_filter", code: "invalid_filter", fields });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects cross-origin and cookie-less calls before transport", async () => {
  expect((await post(range, { origin: "https://evil.test" })).status).toBe(403);
  expect((await post(range, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  const response = await post();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthenticated", code: "unauthenticated" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects unreadable and oversized bodies", async () => {
  expect((await post("{nope")).status).toBe(400);
  expect((await post(JSON.stringify({ ...range, category: "x".repeat(20_000) }))).status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("relays audit_export_too_large with row_count and limit, and no file", async () => {
  fetchMock.mockResolvedValue(upstreamError(422, "audit_export_too_large", { row_count: 60123, limit: 50000 }));
  const response = await post();
  expect(response.status).toBe(422);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(await response.json()).toEqual({ error: "audit_export_too_large", code: "audit_export_too_large", row_count: 60123, limit: 50000 });
});

it.each([
  [403, "forbidden", 403, "forbidden"],
  [401, "unauthenticated", 401, "unauthenticated"],
  [422, "invalid_filter", 422, "invalid_filter"],
  [500, "internal_error", 502, "server_error"],
  [418, "weird", 502, "unrecognized_response"],
])("maps upstream %s %s to %s %s without the backend message", async (status, code, expected, expectedCode) => {
  fetchMock.mockResolvedValue(upstreamError(status, code));
  const response = await post();
  expect(response.status).toBe(expected);
  const text = await response.text();
  expect(JSON.parse(text)).toMatchObject({ code: expectedCode });
  expect(text).not.toContain("private backend message");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("answers 503 no_response when the API is unreachable and 502 for a non-CSV 200", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await (await post()).json()).toEqual({ error: "no_response", code: "no_response" });
  fetchMock.mockResolvedValue(Response.json({ items: [] }));
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "unrecognized_response", code: "unrecognized_response" });
});
