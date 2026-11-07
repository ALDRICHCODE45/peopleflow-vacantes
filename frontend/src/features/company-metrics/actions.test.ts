import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test/api/v1/", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  listReassignmentsAction, listVacanciesAction, loadAuditedDetailAction, loadMetricsAccessAction, loadOverviewAction, loadRecruiterAction,
} from "./actions";
import { card, carlos, clientId, deliveries, draftId, marianaId, placements, reassignmentPage, recruiterDetail, recruiterPage, summary, vacancyPage } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getActionAccessToken).mockResolvedValue(" private-token ");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const envelope = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });
const call = (index = 0) => { const [url, init] = fetchMock.mock.calls[index]; return { url: new URL(String(url)), init: init as RequestInit }; };

it("reads the role from /me/company and lets only owner and stakeholder in", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ company_id: "c", role: "stakeholder", can: { view_metrics: true }, company: {} }));
  expect(await loadMetricsAccessAction()).toEqual({ kind: "allowed", role: "stakeholder" });
  expect(call().url.pathname).toBe("/me/company");
  expect(new Headers(call().init.headers).get("authorization")).toBe("Bearer private-token");
  fetchMock.mockResolvedValueOnce(Response.json({ company_id: "c", role: "recruiter", company: {} }));
  expect(await loadMetricsAccessAction()).toEqual({ kind: "restricted" });
  fetchMock.mockResolvedValueOnce(envelope(404, "not_found"));
  expect(await loadMetricsAccessAction()).toEqual({ kind: "restricted" });
  fetchMock.mockResolvedValueOnce(envelope(500, "internal_error"));
  expect(await loadMetricsAccessAction()).toMatchObject({ ok: false, reason: "server_error" });
});

it("answers unauthenticated without any request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadMetricsAccessAction()).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(await loadOverviewAction({})).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("loads the summary and every recruiter page with the filters as query parameters", async () => {
  fetchMock.mockImplementation(async (url: URL | string) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/summary")) return Response.json(summary());
    return Response.json(parsed.searchParams.get("cursor") === "next" ? recruiterPage([carlos()]) : recruiterPage([card()], "next"));
  });
  const result = await loadOverviewAction({ from: "2026-08-01", to: "2026-10-31", requester_kind: "client", requester_id: clientId });
  expect(result).toEqual({ ok: true, data: { summary: summary(), recruiters: [card(), carlos()] } });
  const summaryCall = call(0).url;
  expect(summaryCall.pathname).toBe("/v2/me/company/metrics/summary");
  expect(Object.fromEntries(summaryCall.searchParams)).toEqual({ from: "2026-08-01", to: "2026-10-31", requester_kind: "client", requester_id: clientId });
  const recruiterCalls = fetchMock.mock.calls.map(([url]) => new URL(String(url))).filter(url => url.pathname.endsWith("/recruiters"));
  expect(recruiterCalls.map(url => [url.searchParams.get("limit"), url.searchParams.get("cursor")])).toEqual([["100", null], ["100", "next"]]);
});

it("asks for the default 90 days in Mexico City when the URL has no valid period", async () => {
  fetchMock.mockImplementation(async (url: URL | string) => Response.json(String(url).includes("/summary") ? summary() : recruiterPage()));
  await loadOverviewAction({ requester_id: "none" });
  expect(Object.fromEntries(call(0).url.searchParams)).toEqual({ from: "2026-08-10", to: "2026-11-07", requester_id: "none" });
});

it.each([
  [401, "unauthenticated", "unauthenticated"],
  [403, "forbidden", "forbidden"],
  [422, "invalid_filter", "invalid_filter"],
  [500, "internal_error", "server_error"],
] as const)("maps %s %s to «%s» and never leaks the backend message", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code, code === "invalid_filter" ? { fields: [{ field: "to", code: "range" }] } : {}));
  const result = await loadOverviewAction({});
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  if (reason === "invalid_filter") expect(result).toMatchObject({ fields: [{ field: "to", code: "range" }] });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("separates a network failure from an undecodable answer", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await loadOverviewAction({})).toMatchObject({ ok: false, reason: "no_response" });
  fetchMock.mockResolvedValue(Response.json({ ...summary(), score: 1 }));
  expect(await loadOverviewAction({})).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("pages the vacancy and reassignment lists with limit 50 and the opaque cursor", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(vacancyPage()));
  expect(await listVacanciesAction({ filters: { recruiter_id: marianaId }, cursor: "a+/=" })).toEqual({ ok: true, data: vacancyPage() });
  expect(call(0).url.pathname).toBe("/v2/me/company/metrics/vacancies");
  expect(Object.fromEntries(call(0).url.searchParams)).toMatchObject({ recruiter_id: marianaId, limit: "50", cursor: "a+/=" });
  fetchMock.mockResolvedValueOnce(Response.json(reassignmentPage()));
  expect(await listReassignmentsAction({ filters: {} })).toEqual({ ok: true, data: reassignmentPage() });
  expect(call(1).url.pathname).toBe("/v2/me/company/metrics/reassignments");
  expect(call(1).url.searchParams.has("cursor")).toBe(false);
  fetchMock.mockResolvedValueOnce(envelope(400, "invalid_cursor"));
  expect(await listVacanciesAction({ filters: {}, cursor: "old" })).toMatchObject({ ok: false, reason: "invalid_cursor" });
});

it("reads one recruiter and treats an id that is not a user id as not found without a request", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(recruiterDetail()));
  expect(await loadRecruiterAction({ userId: marianaId, filters: {} })).toEqual({ ok: true, data: recruiterDetail() });
  expect(call(0).url.pathname).toBe(`/v2/me/company/metrics/recruiters/${marianaId}`);
  fetchMock.mockResolvedValueOnce(envelope(404, "not_found"));
  expect(await loadRecruiterAction({ userId: marianaId, filters: {} })).toMatchObject({ ok: false, reason: "not_found" });
  expect(await loadRecruiterAction({ userId: "../summary", filters: {} })).toMatchObject({ ok: false, reason: "not_found" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

const period = { from: "2026-08-01", to: "2026-10-31" };
it("reads the audited detail of one vacancy, and only a 200 carries names", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(deliveries()));
  expect(await loadAuditedDetailAction({ report: "deliveries", draftId, period })).toEqual({ ok: true, data: { report: "deliveries", items: deliveries().items } });
  expect(call(0).url.pathname).toBe(`/v2/me/company/metrics/vacancies/${draftId}/deliveries`);
  fetchMock.mockResolvedValueOnce(Response.json(placements()));
  expect(await loadAuditedDetailAction({ report: "placements", draftId, period })).toEqual({ ok: true, data: { report: "placements", items: placements().items } });
  fetchMock.mockResolvedValueOnce(envelope(500, "internal_error"));
  expect(await loadAuditedDetailAction({ report: "deliveries", draftId, period })).toEqual({ ok: false, reason: "server_error", reference: { status: 500, code: "internal_error" } });
  fetchMock.mockResolvedValueOnce(envelope(422, "invalid_filter", { fields: [{ field: "to", code: "required" }] }));
  expect(await loadAuditedDetailAction({ report: "deliveries", draftId, period })).toMatchObject({ ok: false, reason: "invalid_filter", reference: { status: 422 } });
});

// §3.7.9: the detail is not narrowed by the period, but like every metrics route it requires it, and it is not paginated.
it.each(["deliveries", "placements"] as const)("sends exactly the applied period to the audited %s read", async report => {
  fetchMock.mockResolvedValue(Response.json(report === "deliveries" ? deliveries() : placements()));
  await loadAuditedDetailAction({ report, draftId, period });
  expect(call(0).url.pathname).toBe(`/v2/me/company/metrics/vacancies/${draftId}/${report}`);
  expect(call(0).url.search).toBe("?from=2026-08-01&to=2026-10-31");
  await loadAuditedDetailAction({ report, draftId, period: { from: "2026-13-01" } });
  expect(call(1).url.search).toBe("?from=2026-08-10&to=2026-11-07");
});
