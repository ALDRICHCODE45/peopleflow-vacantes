import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 } }));
import { activeLifecycle } from "@/features/jobs/drafts/lifecycle-fixture";
import { getChecklist, saveChecklist, getChecklistMarks, setChecklistMark, clearChecklistMark } from "@/features/vacancy-checklist/client";
const id = "10000000-0000-4000-8000-000000000001";
const read = { token: " token ", vacancyId: id };
const target = { ...read, participationId: id, criterionId: id };
const checklist = { version: "0", criteria: [], reminder_stage_ids: [] };
const body = { criteria: [], reminder_stage_ids: [] };
const markBody = { verdict: "met" as const, note: null };
const mark = { ...markBody, participation_id: id, criterion_id: id, marked_by: { id, full_name: "Ana" }, marked_at: "2026-10-28T12:00:00Z" };
const endpoints = [
  { call: () => getChecklist(read), method: "GET", path: "checklist", payload: checklist, status: 200, body: undefined, etag: true },
  { call: () => saveChecklist({ ...read, ifMatch: '"vc1-never-saved"', body }), method: "PUT", path: "checklist", payload: checklist, status: 200, body, etag: true },
  { call: () => getChecklistMarks(read), method: "GET", path: "checklist/marks", payload: { items: [mark] }, status: 200, body: undefined },
  { call: () => setChecklistMark({ ...target, body: markBody }), method: "PUT", path: `participations/${id}/checklist-marks/${id}`, payload: mark, status: 200, body: markBody },
  { call: () => clearChecklistMark(target), method: "DELETE", path: `participations/${id}/checklist-marks/${id}`, payload: undefined, status: 204, body: undefined },
];
afterEach(() => vi.unstubAllGlobals());
it.each(endpoints)("requests $method $path", async endpoint => {
  const fetch = vi.fn().mockResolvedValue(new Response(endpoint.status === 204 ? null : JSON.stringify(endpoint.payload), { status: endpoint.status, headers: { etag: '"vc1-never-saved"' } })); vi.stubGlobal("fetch", fetch);
  expect(await endpoint.call()).toEqual({ ok: true, data: endpoint.payload ?? null, ...(endpoint.etag ? { etag: '"vc1-never-saved"' } : {}) });
  const [url, init] = fetch.mock.calls[0]; expect(String(url)).toBe(`http://localhost:8080/v2/me/company/job-drafts/${id}/${endpoint.path}`);
  expect(init).toMatchObject({ method: endpoint.method, redirect: "error", cache: "no-store" });
  const headers = new Headers(init.headers); expect(headers.get("authorization")).toBe("Bearer token"); expect(headers.get("if-match")).toBe(endpoint.method === "PUT" && endpoint.path === "checklist" ? '"vc1-never-saved"' : null);
  expect(init.body).toBe(endpoint.body ? JSON.stringify(endpoint.body) : undefined);
});
for (const endpoint of endpoints) {
  it.each([[400, "validation_error"], [401, "unauthenticated"], [403, "forbidden"], [404, "not_found"], [412, "version_conflict"], [409, "process_finished"], [428, "precondition_required"]] as const)(`${endpoint.method} maps %s`, async (status, reason) => {
    const fields = [{ field: "criteria[2].params.min", code: "invalid" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: status === 400 ? "validation failed" : "failed", code: reason, ...(status === 400 ? { fields } : {}) }), { status })));
    expect(await endpoint.call()).toMatchObject({ ok: false, reason, ...(status === 400 ? { fields } : {}) });
  });
  it(`${endpoint.method} network fails without retry`, async () => { const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch); expect(await endpoint.call()).toMatchObject({ ok: false, reason: "no_response" }); expect(fetch).toHaveBeenCalledTimes(1); });
}
it("guards token, IDs, body and etag before transport", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await getChecklist({ ...read, token: "" })).toMatchObject({ reason: "unauthenticated" });
  expect(await getChecklist({ ...read, vacancyId: "../" })).toMatchObject({ reason: "invalid_request" });
  expect(await saveChecklist({ ...read, ifMatch: "", body })).toMatchObject({ reason: "precondition_required" });
  expect(await setChecklistMark({ ...target, body: {} })).toMatchObject({ reason: "validation_error" });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["required", "invalid", "too_long", "duplicate", "not_allowed"])("preserves validation field code %s", async code => {
  const fields = [{ field: "criteria[0]", code }];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "validation failed", code: "validation_error", fields }), { status: 400 })));
  expect(await saveChecklist({ ...read, ifMatch: '"vc1-never-saved"', body })).toMatchObject({ reason: "validation_error", fields });
});
it("recognizes the lifecycle envelope on finished-process writes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "finished", code: "process_finished", data: { lifecycle: activeLifecycle } }), { status: 409 })));
  expect(await saveChecklist({ ...read, ifMatch: '"vc1-never-saved"', body })).toMatchObject({ reason: "process_finished" });
});
it("maps malformed-header 400 separately from validation errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid", code: "invalid_request" }), { status: 400 })));
  expect(await getChecklist(read)).toMatchObject({ reason: "invalid_request" });
});
it("rejects missing etag and invalid successful payload", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(checklist)))); expect(await getChecklist(read)).toMatchObject({ reason: "unrecognized_response" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers: { etag: '"0"' } }))); expect(await getChecklist(read)).toMatchObject({ reason: "unrecognized_response" });
});
