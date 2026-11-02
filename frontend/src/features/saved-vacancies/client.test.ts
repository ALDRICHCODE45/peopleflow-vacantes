import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { legacyDetail, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import { saveJob, removeSavedJob, removeClosedSavedJobs, loadSavedJobs, loadSavedJobIds } from "./client";
import { saveJobAction, removeSavedJobAction, loadSavedJobsAction, loadSavedJobIdsAction, removeClosedSavedJobsAction } from "./actions";
const id = vacancyDetail.id;
const saved = { job_id: id, saved_at: "2026-11-01T12:00:00Z" };
function row(detail = vacancyDetail as typeof vacancyDetail | typeof legacyDetail) {
  const { source, title, company, location_label, work_mode, compensation, legacy_salary, published_at } = detail;
  return { ...saved, job_id: detail.id, availability: "open", closed_at: null, application: null,
    job: { source, title, company, location_label, work_mode, compensation, legacy_salary, published_at } };
}
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("test-token"); });
afterEach(() => vi.unstubAllGlobals());
it.each([200, 201])("decodes idempotent save %i with no body and server credentials", async status => {
  fetchMock.mockResolvedValue(Response.json(saved, { status }));
  expect(await saveJob({ token: "test-token", id })).toEqual({ ok: true, data: saved });
  expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.example.test/v2/me/saved-jobs/${id}`);
  const init = fetchMock.mock.calls[0][1];
  expect(init).toMatchObject({ method: "PUT", cache: "no-store", redirect: "error" });
  expect(init.body).toBeUndefined();
  expect(init.headers.get("authorization")).toBe("Bearer test-token");
});
it("decodes every read and delete endpoint, including C1, C2 and C5", async () => {
  const items = [{ ...row(legacyDetail), availability: "closed", closed_at: "2026-10-31T12:00:00-06:00" }, row(),
    { ...row({ ...vacancyDetail, id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94" }), availability: "closed", closed_at: null, application: { id, applied_at: saved.saved_at } }];
  const list = { items, total: 3, limit: 200 };
  // The client preserves backend order (saved_at DESC, job_id ASC), never a local re-sort.
  fetchMock.mockResolvedValueOnce(Response.json(list)).mockResolvedValueOnce(Response.json({ job_ids: [id] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(Response.json({ removed: 3 }));
  expect(await loadSavedJobs({ token: "test-token" })).toEqual({ ok: true, data: list });
  expect(await loadSavedJobIds({ token: "test-token" })).toEqual({ ok: true, data: { job_ids: [id] } });
  expect(await removeSavedJob({ token: "test-token", id })).toEqual({ ok: true, data: null });
  expect(await removeClosedSavedJobs({ token: "test-token" })).toEqual({ ok: true, data: { removed: 3 } });
  expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init.method])).toEqual([
    ["https://api.example.test/v2/me/saved-jobs", "GET"], ["https://api.example.test/v2/me/saved-jobs/ids", "GET"],
    [`https://api.example.test/v2/me/saved-jobs/${id}`, "DELETE"], ["https://api.example.test/v2/me/saved-jobs?availability=closed", "DELETE"],
  ]);
});
it.each([
  { ...row(), availability: "paused" }, { ...row(), closed_at: "bad" }, { ...row(), application: { id, applied_at: "bad" } },
  { ...row(legacyDetail), application: { id, applied_at: saved.saved_at } },
  { ...row(legacyDetail), job: { ...row(legacyDetail).job, legacy_salary: { min: 123, max: null, currency: "MXN" } } },
  { ...row(legacyDetail), job: { ...row(legacyDetail).job, compensation: vacancyDetail.compensation } },
  { ...row(), job: { ...row().job, legacy_salary: legacyDetail.legacy_salary } },
  { ...row(), job: { ...row().job, extra: true } },
])("rejects malformed snapshots without falling back: %j", async item => {
  fetchMock.mockResolvedValue(Response.json({ items: [item], total: 1, limit: 200 }));
  expect(await loadSavedJobs({ token: "test-token" })).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it.each([
  [404, "not_found", undefined], [409, "job_unavailable", undefined], [409, "saved_jobs_limit", { limit: 200 }],
  [400, "validation_error", undefined], [401, "unauthenticated", undefined], [403, "forbidden", undefined],
  [503, "internal_error", undefined],
] as const)("sanitizes and decodes %i %s through all actions", async (status, code, data) => {
  const error = code === "job_unavailable" ? "job unavailable" : code === "saved_jobs_limit" ? "saved jobs limit reached" : code === "validation_error" ? "validation failed" : "private diagnostic";
  fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error, code, ...(data ? { data } : {}),
    ...(code === "validation_error" ? { fields: [{ field: "availability", code: "invalid" }] } : {}) }, { status })));
  for (const result of [await saveJobAction(id), await removeSavedJobAction(id), await loadSavedJobsAction(), await loadSavedJobIdsAction(), await removeClosedSavedJobsAction()]) {
    expect(result).toEqual({ ok: false, reason: status >= 500 ? "server_error" : code,
      reference: { status, ...(["internal_error"].includes(code) ? {} : { code }) }, ...(data ? { limit: 200 } : {}) });
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  }
});
it.each([
  [{ job_ids: [id, id] }, "ids"], [{ job_ids: ["bad"] }, "ids"], [{ job_ids: [], extra: true }, "ids"],
  [{ removed: -1 }, "bulk"], [{ removed: 1.5 }, "bulk"], [{ removed: 201 }, "bulk"],
  [{ ...saved, saved_at: "bad" }, "save"], [{ ...saved, extra: true }, "save"],
] as const)("rejects malformed endpoint payload %j", async (payload, endpoint) => {
  fetchMock.mockResolvedValue(Response.json(payload));
  const result = endpoint === "ids" ? await loadSavedJobIdsAction() : endpoint === "bulk" ? await removeClosedSavedJobsAction() : await saveJobAction(id);
  expect(result).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it("requires fields, not data, on the shared validation envelope", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "validation failed", code: "validation_error", data: { availability: "invalid" } }, { status: 400 }));
  expect(await removeClosedSavedJobsAction()).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 400 } });
});
it("does not trust mismatched codes, unknown codes or malformed limits", async () => {
  for (const [status, code, data] of [[400, "job_unavailable", null], [409, "saved_jobs_limit", { limit: "200" }], [400, "private diagnostic", null]] as const) {
    fetchMock.mockResolvedValue(Response.json({ error: "private diagnostic", code, data }, { status }));
    expect(await saveJobAction(id)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  }
});
it("rejects unsafe ids locally and fails closed without a session", async () => {
  for (const unsafe of ["../ids", "bad", "ids?availability=closed"]) {
    expect(await saveJob({ token: "test-token", id: unsafe })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await removeSavedJob({ token: "test-token", id: unsafe })).toMatchObject({ ok: false, reason: "not_found" });
  }
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadSavedJobIdsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("classifies no response, invalid successes and unexpected statuses", async () => {
  fetchMock.mockRejectedValueOnce(new Error("private diagnostic"));
  expect(await saveJobAction(id)).toEqual({ ok: false, reason: "no_response", reference: {} });
  for (const response of [Response.json({ ...saved, job_id: legacyDetail.id }), Response.json(saved, { status: 202 })]) {
    fetchMock.mockResolvedValue(response);
    expect(await saveJobAction(id)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  }
  fetchMock.mockResolvedValue(Response.json({}, { status: 200 }));
  expect(await removeSavedJobAction(id)).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
