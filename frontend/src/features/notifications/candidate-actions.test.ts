import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  getCandidateFacetsAction, getCandidateUnreadCountAction, getUnreadCountAction, listCandidateNotificationsAction, listNotificationsAction,
  markAllCandidateReadAction, markAllReadAction, markCandidateReadAction, markCandidateUnreadAction,
} from "./actions";
import { applicationsGroup, candidateGroup, candidatePage, markResult, notificationFacets, notificationPage } from "./test-fixtures";

/** Candidate inbox (T3.6, L14): same shapes as the company inbox on `/v2/me/notifications`. */
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue("candidate-token"); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string) => Response.json({ error: "private backend message", code }, { status });
const requested = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url: new URL(String(url)), method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(init.body) };
};
const markedAt = "2026-11-26T18:45:02.123456Z";

it("reads the candidate list, counter and facets on /v2/me/notifications with the session token", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(candidatePage()))
    .mockResolvedValueOnce(Response.json({ unread_count: 2, unread_notifications: 2 }))
    .mockResolvedValueOnce(Response.json(notificationFacets({ types: [{ type: "candidate_status_changed", count: 1 }] })));
  expect(await listCandidateNotificationsAction({ state: "unread" })).toEqual({ ok: true, data: candidatePage() });
  expect(await getCandidateUnreadCountAction()).toEqual({ ok: true, data: { unread_count: 2, unread_notifications: 2 } });
  expect(await getCandidateFacetsAction("all")).toMatchObject({ ok: true });
  expect(requested(0).url.toString()).toBe("https://api.example.test/v2/me/notifications?state=unread&limit=20");
  expect(requested(0).headers.get("authorization")).toBe("Bearer candidate-token");
  expect(requested(1).url.pathname).toBe("/v2/me/notifications/unread-count");
  expect(requested(2).url.toString()).toBe("https://api.example.test/v2/me/notifications/facets?state=all");
});

it("writes read, unread (exact undo) and read-all on the candidate paths", async () => {
  fetchMock.mockImplementation(async () => Response.json(markResult()));
  const key = candidateGroup().group_key;
  await markCandidateReadAction({ groupKeys: [key] });
  await markCandidateUnreadAction({ markedAt });
  await markAllCandidateReadAction({ before: "2026-11-26T18:44:00Z" });
  expect(requested(0)).toMatchObject({ method: "POST", body: { group_keys: [key] } });
  expect(requested(0).url.pathname).toBe("/v2/me/notifications/read");
  expect(requested(1).url.pathname).toBe("/v2/me/notifications/unread");
  expect(requested(1).body).toEqual({ marked_at: markedAt });
  expect(requested(2).url.pathname).toBe("/v2/me/notifications/read-all");
  expect(requested(2).body).toEqual({ before: "2026-11-26T18:44:00Z" });
});

it("never lets the caller pick the path: a smuggled scope or path is ignored on both sides", async () => {
  fetchMock.mockImplementation(async () => Response.json(candidatePage()));
  await listCandidateNotificationsAction({ scope: "company", path: "/v2/admin" } as never);
  await listNotificationsAction({ scope: "candidate" } as never);
  expect(requested(0).url.pathname).toBe("/v2/me/notifications");
  expect(requested(1).url.pathname).toBe("/v2/me/company/notifications");
  fetchMock.mockImplementation(async () => Response.json(markResult()));
  await markAllCandidateReadAction({ scope: "company" } as never);
  await markAllReadAction({ scope: "candidate" } as never);
  expect(requested(2).url.pathname).toBe("/v2/me/notifications/read-all");
  expect(requested(2).body).toEqual({});
  expect(requested(3).url.pathname).toBe("/v2/me/company/notifications/read-all");
});

it("accepts company null (vacancy no longer resolvable) and a null link", async () => {
  const orphan = candidateGroup({ company: null, job: null, link: null });
  fetchMock.mockResolvedValue(Response.json(candidatePage({ items: [orphan] })));
  expect(await listCandidateNotificationsAction()).toMatchObject({ ok: true, data: { items: [{ company: null, job: null, link: null }] } });
});

it("keeps member pages valid with company omitted, present or null", async () => {
  const page = notificationPage({ items: [applicationsGroup(), applicationsGroup({ group_key: "n:x", company: null })] });
  fetchMock.mockResolvedValue(Response.json(page));
  const result = await listNotificationsAction();
  expect(result).toMatchObject({ ok: true });
  if (result.ok) expect(result.data.items.map(item => item.company)).toEqual([undefined, null]);
});

it.each([
  ["account_required"],
  ["wrong_role"],
])("maps candidate 403 %s to «forbidden», keeping the allowlisted code and never the message", async code => {
  fetchMock.mockImplementation(async () => envelope(403, code));
  for (const run of [() => listCandidateNotificationsAction(), getCandidateUnreadCountAction]) {
    const result = await run();
    expect(result).toEqual({ ok: false, reason: "forbidden", reference: { status: 403, code } });
    expect(JSON.stringify(result)).not.toContain("private backend message");
  }
});

it("answers unauthenticated without a request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await listCandidateNotificationsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await getCandidateUnreadCountAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await getUnreadCountAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});
