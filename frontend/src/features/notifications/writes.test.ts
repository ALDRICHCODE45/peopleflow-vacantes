import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getFacetsAction, markAllReadAction, markReadAction, markUnreadAction } from "./actions";
import { jobId, markResult, notificationFacets, otherJobId } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });
const requested = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url: new URL(String(url)), method: init.method, headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(init.body), redirect: init.redirect };
};
const groupKey = `applications:${jobId}:2026-11-26`;
const singleKey = "n:01937a11-0000-7000-8000-000000000001";
const notificationId = "01937c90-0000-7000-8000-000000000001";
const markedAt = "2026-11-26T18:45:02.123456Z";

it("marks groups read with a JSON POST, the session token and exactly the group_keys body", async () => {
  fetchMock.mockResolvedValue(Response.json(markResult()));
  expect(await markReadAction({ groupKeys: [groupKey, singleKey] })).toEqual({ ok: true, data: markResult() });
  const { url, method, headers, body, redirect } = requested();
  expect(url.toString()).toBe("https://api.example.test/v2/me/company/notifications/read");
  expect(method).toBe("POST");
  expect(headers.get("authorization")).toBe("Bearer private-token");
  expect(headers.get("content-type")).toBe("application/json");
  expect(redirect).toBe("error");
  expect(body).toEqual({ group_keys: [groupKey, singleKey] });
});

it("accepts every D11 group key shape and the limits themselves", async () => {
  fetchMock.mockImplementation(async () => Response.json(markResult()));
  const keys = [`psychometrics:${jobId}:2026-01-31`, `psychometrics_pending:${jobId}:2024-02-29`, singleKey];
  expect(await markReadAction({ groupKeys: keys })).toMatchObject({ ok: true });
  expect(await markReadAction({ groupKeys: Array(100).fill(groupKey) })).toMatchObject({ ok: true });
  expect(await markUnreadAction({ ids: Array(200).fill(notificationId) })).toMatchObject({ ok: true });
  expect(requested(0).body).toEqual({ group_keys: keys });
});

it("marks single notifications read or unread by ids", async () => {
  fetchMock.mockImplementation(async () => Response.json(markResult({ affected_groups: 2 })));
  expect(await markReadAction({ ids: [notificationId] })).toMatchObject({ ok: true, data: { affected_groups: 2 } });
  expect(await markUnreadAction({ ids: [notificationId] })).toMatchObject({ ok: true });
  expect(requested(0).body).toEqual({ ids: [notificationId] });
  expect(requested(1).url.pathname).toBe("/v2/me/company/notifications/unread");
  expect(requested(1).body).toEqual({ ids: [notificationId] });
});

it("undoes a mark exactly with marked_at on unread", async () => {
  fetchMock.mockResolvedValue(Response.json(markResult({ unread_count: 4, unread_notifications: 6 })));
  expect(await markUnreadAction({ markedAt })).toMatchObject({ ok: true, data: { unread_count: 4 } });
  expect(requested().url.pathname).toBe("/v2/me/company/notifications/unread");
  expect(requested().body).toEqual({ marked_at: markedAt });
});

it("marks everything read with an empty body, and omits empty filter arrays instead of sending them", async () => {
  fetchMock.mockImplementation(async () => Response.json(markResult()));
  await markAllReadAction();
  await markAllReadAction({ types: [], jobIds: [] });
  await markAllReadAction({ types: ["application_received"], jobIds: [jobId, otherJobId], before: "2026-11-26T18:44:00Z" });
  expect(requested(0).url.pathname).toBe("/v2/me/company/notifications/read-all");
  expect(requested(0).method).toBe("POST");
  expect(requested(0).body).toEqual({});
  expect(requested(1).body).toEqual({});
  expect(requested(2).body).toEqual({ types: ["application_received"], job_ids: [jobId, otherJobId], before: "2026-11-26T18:44:00Z" });
});

it("decodes facets, unread by default and all on request, keeping an unknown type", async () => {
  const facets = notificationFacets({ types: [{ type: "something_new", count: 1 }] });
  fetchMock.mockImplementation(async () => Response.json(facets));
  expect(await getFacetsAction()).toEqual({ ok: true, data: facets });
  await getFacetsAction("all");
  expect(requested(0).url.toString()).toBe("https://api.example.test/v2/me/company/notifications/facets?state=unread");
  expect(requested(0).method ?? "GET").toBe("GET");
  expect(requested(1).url.search).toBe("?state=all");
});

it("rejects facets that break the contract", async () => {
  const tooManyJobs = Array.from({ length: 51 }, () => ({ job_id: jobId, title: null, count: 1 }));
  for (const bad of [notificationFacets({ jobs: tooManyJobs }), { ...notificationFacets(), jobs: [{ job_id: "nope", title: null, count: 1 }] }, { ...notificationFacets(), jobs_total: -1 }]) {
    fetchMock.mockResolvedValueOnce(Response.json(bad));
    expect(await getFacetsAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  }
});

it("rejects a mark response without marked_at", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...markResult(), marked_at: undefined }));
  expect(await markReadAction({ ids: [notificationId] })).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it.each([
  ["no selection", "read", {}, [{ field: "body", code: "required" }]],
  ["two selections", "read", { groupKeys: [groupKey], ids: [notificationId] }, [{ field: "body", code: "invalid" }]],
  ["marked_at on read", "read", { markedAt }, [{ field: "marked_at", code: "not_allowed" }]],
  ["empty group keys", "read", { groupKeys: [] }, [{ field: "group_keys", code: "empty" }]],
  ["101 group keys", "read", { groupKeys: Array(101).fill(groupKey) }, [{ field: "group_keys", code: "too_many" }]],
  ["201 ids", "unread", { ids: Array(201).fill(notificationId) }, [{ field: "ids", code: "too_many" }]],
  ["empty ids", "unread", { ids: [] }, [{ field: "ids", code: "empty" }]],
  ["malformed id", "unread", { ids: ["not-a-uuid"] }, [{ field: "ids", code: "invalid" }]],
  ["nil id", "read", { ids: ["00000000-0000-0000-0000-000000000000"] }, [{ field: "ids", code: "invalid" }]],
  ["unknown group prefix", "read", { groupKeys: [`made_up:${jobId}:2026-11-26`] }, [{ field: "group_keys", code: "invalid" }]],
  ["impossible group day", "read", { groupKeys: [`applications:${jobId}:2026-02-30`] }, [{ field: "group_keys", code: "invalid" }]],
  ["single key with a day", "read", { groupKeys: [`n:${notificationId}:2026-11-26`] }, [{ field: "group_keys", code: "invalid" }]],
  ["timestamp without offset", "unread", { markedAt: "2026-11-26T18:45:02" }, [{ field: "marked_at", code: "invalid" }]],
  ["unknown key", "read", { groupKeys: [groupKey], extra: true }, [{ field: "body", code: "invalid" }]],
] as const)("refuses %s locally with validation_error and no request", async (_name, action, target, fields) => {
  const run = action === "read" ? markReadAction : markUnreadAction;
  expect(await run(target as never)).toEqual({ ok: false, reason: "validation_error", fields, reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [{ types: ["made_up"] }, [{ field: "types", code: "invalid" }]],
  [{ types: Array(15).fill("application_received") }, [{ field: "types", code: "too_many" }]],
  [{ jobIds: ["nope"] }, [{ field: "job_ids", code: "invalid" }]],
  [{ jobIds: Array(21).fill(jobId) }, [{ field: "job_ids", code: "too_many" }]],
  [{ before: "yesterday" }, [{ field: "before", code: "invalid" }]],
  [{ types: ["made_up"], before: "yesterday" }, [{ field: "before", code: "invalid" }, { field: "types", code: "invalid" }]],
] as const)("refuses read-all %j locally", async (input, fields) => {
  expect(await markAllReadAction(input as never)).toEqual({ ok: false, reason: "validation_error", fields, reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses an unknown facets state locally as invalid_filter", async () => {
  expect(await getFacetsAction("read" as never)).toMatchObject({ ok: false, reason: "invalid_filter" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers unauthenticated without a request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue("  ");
  const unauthenticated = { ok: false, reason: "unauthenticated", reference: {} };
  expect(await markReadAction({ groupKeys: [groupKey] })).toEqual(unauthenticated);
  expect(await markUnreadAction({ markedAt })).toEqual(unauthenticated);
  expect(await markAllReadAction()).toEqual(unauthenticated);
  expect(await getFacetsAction()).toEqual(unauthenticated);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("maps a backend validation_error with its bounded fields and never leaks the message", async () => {
  fetchMock.mockResolvedValue(envelope(400, "validation_error", { fields: [{ field: "group_keys", code: "invalid" }, { field: "group_keys", code: "secret detail" }] }));
  const result = await markReadAction({ groupKeys: [groupKey] });
  expect(result).toEqual({ ok: false, reason: "validation_error", fields: [{ field: "group_keys", code: "invalid" }], reference: { status: 400, code: "validation_error" } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it.each([
  [401, "unauthenticated", "unauthenticated"],
  [403, "forbidden", "forbidden"],
  [403, "company_inactive", "forbidden"],
  [413, "payload_too_large", "unrecognized_response"],
  [400, "invalid_request", "unrecognized_response"],
  [500, "internal_error", "server_error"],
] as const)("maps write %s %s to «%s»", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code));
  const result = await markAllReadAction();
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("maps a network failure on a write to no_response", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await markReadAction({ ids: [notificationId] })).toMatchObject({ ok: false, reason: "no_response" });
});
