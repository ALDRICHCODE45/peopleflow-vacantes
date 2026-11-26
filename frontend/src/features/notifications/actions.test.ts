import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getUnreadCountAction, listNotificationsAction } from "./actions";
import { applicationsGroup, jobId, notificationPage, otherJobId } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });
const requested = () => { const [url, init] = fetchMock.mock.calls[0]; return { url: new URL(String(url)), headers: new Headers(init.headers) }; };

it("lists the grouped inbox with the session token and decodes the page", async () => {
  fetchMock.mockResolvedValue(Response.json(notificationPage()));
  expect(await listNotificationsAction()).toEqual({ ok: true, data: notificationPage() });
  const { url, headers } = requested();
  expect(url.origin + url.pathname).toBe("https://api.example.test/v2/me/company/notifications");
  expect(url.search).toBe("?limit=20");
  expect(headers.get("authorization")).toBe("Bearer private-token");
});

it("sends state, types, job ids, cursor and limit as the contract names them", async () => {
  fetchMock.mockResolvedValue(Response.json(notificationPage({ attention: null, attention_total: null })));
  await listNotificationsAction({ state: "unread", types: ["application_received", "delivery_overdue"], jobIds: [jobId, otherJobId], cursor: "abc", limit: 50 });
  const { searchParams } = requested().url;
  expect(Object.fromEntries(searchParams)).toEqual({
    state: "unread", types: "application_received,delivery_overdue", job_ids: `${jobId},${otherJobId}`, cursor: "abc", limit: "50",
  });
});

it("refuses an out-of-contract query without calling the API", async () => {
  for (const input of [{ limit: 0 }, { limit: 51 }, { jobIds: ["not-a-uuid"] }, { types: ["made_up"] }, { state: "read" }] as const) {
    expect(await listNotificationsAction(input as never)).toMatchObject({ ok: false, reason: "invalid_filter" });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps an unknown future type and drops a link kind it cannot route", async () => {
  const future = { ...applicationsGroup(), type: "something_new", link: { kind: "teleport", job_id: jobId }, extra: true };
  fetchMock.mockResolvedValue(Response.json(notificationPage({ items: [future as never] })));
  const result = await listNotificationsAction();
  expect(result).toMatchObject({ ok: true, data: { items: [{ type: "something_new", link: null }] } });
  expect(JSON.stringify(result)).not.toContain("extra");
});

it("reads the bell counter", async () => {
  fetchMock.mockResolvedValue(Response.json({ unread_count: 4, unread_notifications: 6 }));
  expect(await getUnreadCountAction()).toEqual({ ok: true, data: { unread_count: 4, unread_notifications: 6 } });
  expect(requested().url.pathname).toBe("/v2/me/company/notifications/unread-count");
});

it("answers unauthenticated without a request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await listNotificationsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await getUnreadCountAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [401, "unauthenticated", "unauthenticated"],
  [403, "forbidden", "forbidden"],
  [403, "company_inactive", "forbidden"],
  [400, "invalid_filter", "invalid_filter"],
  [400, "invalid_cursor", "invalid_cursor"],
  [500, "internal_error", "server_error"],
  [503, "anything", "server_error"],
] as const)("maps %s %s to «%s» and never leaks the backend message", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code));
  const result = await listNotificationsAction();
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("separates a network failure from an undecodable answer", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await getUnreadCountAction()).toMatchObject({ ok: false, reason: "no_response" });
  fetchMock.mockResolvedValue(Response.json({ unread_count: "many" }));
  expect(await getUnreadCountAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
