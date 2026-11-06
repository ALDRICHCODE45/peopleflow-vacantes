import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listAuditEventsAction, loadAuditOptionsAction } from "./actions";
import { auditActors, auditPage, auditTypes, auditVacancies } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });

it("lists with the session token and returns the decoded page", async () => {
  fetchMock.mockResolvedValue(Response.json(auditPage()));
  expect(await listAuditEventsAction({ filters: { from: "2026-11-01" }, cursor: "c" })).toEqual({ ok: true, data: auditPage() });
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(String(url)).searchParams.get("from")).toBe("2026-11-01");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("answers unauthenticated without a request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await listAuditEventsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await loadAuditOptionsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [401, "unauthenticated", "unauthenticated"],
  [403, "forbidden", "forbidden"],
  [422, "invalid_filter", "invalid_filter"],
  [400, "invalid_cursor", "invalid_cursor"],
  [500, "internal_error", "server_error"],
  [503, "anything", "server_error"],
] as const)("maps %s %s to «%s» and never leaks the backend message", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code, code === "invalid_filter" ? { fields: [{ field: "from", code: "range" }] } : {}));
  const result = await listAuditEventsAction();
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
  if (reason === "invalid_filter") expect(result).toMatchObject({ fields: [{ field: "from", code: "range" }] });
});

it("does not trust a status/code combination the contract never produces", async () => {
  fetchMock.mockResolvedValue(envelope(404, "invalid_filter"));
  expect(await listAuditEventsAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockResolvedValue(envelope(422, "invalid_cursor"));
  expect(await listAuditEventsAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("separates a network failure from an undecodable answer", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await listAuditEventsAction()).toMatchObject({ ok: false, reason: "no_response" });
  fetchMock.mockResolvedValue(Response.json({ items: "nope" }));
  expect(await listAuditEventsAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("loads the three filter catalogs together", async () => {
  fetchMock.mockImplementation(async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    return Response.json(path.endsWith("/types") ? { items: auditTypes } : path.endsWith("/actors") ? { items: auditActors } : { items: auditVacancies });
  });
  expect(await loadAuditOptionsAction()).toEqual({ ok: true, types: auditTypes, actors: auditActors, vacancies: auditVacancies });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("fails the whole option load when any catalog fails, reporting the most telling reason", async () => {
  fetchMock.mockImplementation(async (url: URL | string) => String(url).endsWith("/actors") ? envelope(403, "forbidden") : Response.json({ items: [] }));
  expect(await loadAuditOptionsAction()).toMatchObject({ ok: false, reason: "forbidden" });
  fetchMock.mockImplementation(async (url: URL | string) => String(url).endsWith("/types") ? envelope(500, "internal_error") : Response.json({ items: [] }));
  expect(await loadAuditOptionsAction()).toMatchObject({ ok: false, reason: "server_error" });
});
