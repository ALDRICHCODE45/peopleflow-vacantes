import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 } }));
import * as c from "./client";
import { profile, body, invitation, result, comparison, base, items, id, date } from "./fixtures.test";
const read = { token: " session ", vacancyId: id };
const target = { ...read, invitationId: id };
const etag = '"pp1-never-saved"';
const employerPrefix = `/v2/me/company/job-drafts/${id}`;
const endpoints = [
  { call: () => c.getAccountAssessments({ token: " session " }), method: "GET", path: "/v2/me/assessments", payload: { items: [] }, status: 200 },
  { call: () => c.getProfile(read), method: "GET", path: `${employerPrefix}/psychometric-profile`, payload: profile, status: 200, etag: true, body: undefined },
  { call: () => c.saveProfile({ ...read, body, ifMatch: etag }), method: "PUT", path: `${employerPrefix}/psychometric-profile`, payload: profile, status: 200, etag: true, body },
  { call: () => c.getInvitations(read), method: "GET", path: `${employerPrefix}/psychometric-invitations`, payload: { items: [invitation] }, status: 200 },
  ...[200, 201].map(status => ({ call: () => c.createInvitation({ ...read, participationId: id }), method: "POST", path: `${employerPrefix}/participations/${id}/psychometric-invitations`, payload: invitation, status })),
  { call: () => c.mintLink(target), method: "POST", path: `${employerPrefix}/psychometric-invitations/${id}/link`, payload: { token: "opaque", expires_at: date }, status: 200 },
  { call: () => c.remindInvitation(target), method: "POST", path: `${employerPrefix}/psychometric-invitations/${id}/reminders`, payload: invitation, status: 200 },
  { call: () => c.revokeInvitation(target), method: "POST", path: `${employerPrefix}/psychometric-invitations/${id}/revoke`, payload: invitation, status: 200 },
  { call: () => c.getResult(target), method: "GET", path: `${employerPrefix}/psychometric-invitations/${id}/result`, payload: result, status: 200 },
  { call: () => c.createComparison(target), method: "POST", path: `${employerPrefix}/psychometric-invitations/${id}/comparisons`, payload: comparison, status: 201 },
];
const candidates = ([{ access: "public", assessmentToken: "public_secret-token" }, { access: "account", invitationId: id, token: " session " }] as const).flatMap(input => {
  const prefix = input.access === "public" ? `/v2/assessments/${input.assessmentToken}` : `/v2/me/assessments/${id}`;
  return [
    { call: () => c.getAssessment(input), method: "GET", path: prefix, payload: base, status: 200 },
    { call: () => c.giveConsent({ ...input, body: { notice_version: "1", text_sha256: "a".repeat(64) } }), method: "POST", path: `${prefix}/consent`, payload: null, status: 204, body: { notice_version: "1", text_sha256: "a".repeat(64) } },
    { call: () => c.getItems(input), method: "GET", path: `${prefix}/items`, payload: items, status: 200 },
    { call: () => c.putAnswer({ ...input, position: 1, body: { event_id: id, value: 3, client_elapsed_ms: 4200 } }), method: "PUT", path: `${prefix}/answers/1`, payload: null, status: 204, body: { event_id: id, value: 3, client_elapsed_ms: 4200 } },
    { call: () => c.deleteAnswer({ ...input, position: 1, body: { event_id: id } }), method: "DELETE", path: `${prefix}/answers/1`, payload: null, status: 204, body: { event_id: id } },
    { call: () => c.finishAssessment(input), method: "POST", path: `${prefix}/finish`, payload: { status: "finished" }, status: 200 },
  ].map(endpoint => ({ ...endpoint, public: input.access === "public" }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([...endpoints, ...candidates])("requests $method $path ($status)", async endpoint => {
  const fetch = vi.fn().mockResolvedValue(new Response(endpoint.status === 204 ? null : JSON.stringify(endpoint.payload), { status: endpoint.status, headers: { etag } })); vi.stubGlobal("fetch", fetch);
  expect(await endpoint.call()).toEqual({ ok: true, data: endpoint.payload, ...("etag" in endpoint && endpoint.etag ? { etag } : {}) });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]; expect(String(url)).toBe(`http://localhost:8080${endpoint.path}`);
  expect(init).toMatchObject({ method: endpoint.method, redirect: "error", cache: "no-store" });
  const headers = new Headers(init.headers); expect(headers.get("authorization")).toBe("public" in endpoint && endpoint.public ? null : "Bearer session");
  expect(headers.get("if-match")).toBe(endpoint.method === "PUT" && endpoint.path.endsWith("profile") ? etag : null);
  expect(headers.get("accept")).toBe("application/json");
  expect(init.body).toBe("body" in endpoint && endpoint.body ? JSON.stringify(endpoint.body) : undefined);
  if ("body" in endpoint && endpoint.body) expect(headers.get("content-type")).toBe("application/json");
  if ("public" in endpoint && endpoint.public) { expect(init.credentials).toBe("omit"); expect(init.referrerPolicy).toBe("no-referrer"); }
});
const errors = [[404, "assessment_unavailable"], [403, "consent_required"], [409, "notice_changed"], [409, "assessment_finished"], [409, "invitation_closed"], [422, "incomplete"], [409, "profile_disabled"], [409, "profile_unconfirmed"], [409, "already_finished"], [409, "participation_inactive"], [409, "process_finished"], [429, "rate_limited"], [412, "version_conflict"], [428, "precondition_required"], [401, "unauthenticated"], [403, "forbidden"], [404, "not_found"], [400, "validation_error"], [400, "invalid_request"], [500, "server_error"]] as const;
for (const endpoint of [...endpoints, ...candidates]) {
  it.each(errors)(`${endpoint.method} ${endpoint.path} maps %s %s`, async (status, reason) => {
    const fields = [{ field: "value", code: "invalid" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "NEVER expose public_secret-token", code: reason, ...(reason === "validation_error" ? { fields } : {}), ...(reason === "incomplete" ? { data: { missing_positions: [1, 63] } } : {}) }), { status, headers: { "Retry-After": "60" } })));
    expect(await endpoint.call()).toEqual({ ok: false, reason, reference: { status, code: reason }, ...(reason === "validation_error" ? { fields } : {}), ...(reason === "incomplete" ? { missing_positions: [1, 63] } : {}), ...(reason === "rate_limited" && "public" in endpoint ? { retryAfter: "60" } : {}) });
  });
  it(`${endpoint.method} ${endpoint.path} contains network errors without retry or token leakage`, async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("public_secret-token")); vi.stubGlobal("fetch", fetch);
    expect(await endpoint.call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(fetch).toHaveBeenCalledTimes(1);
  });
}
it("guards the account list session and rejects result data in list responses", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await c.getAccountAssessments({ token: " " })).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValue(new Response(JSON.stringify({ items: [], scores: [1] })));
  expect(await c.getAccountAssessments({ token: "session" })).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it("guards identifiers, credentials, profile preconditions and candidate payloads before transport", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const bad = { access: "public" as const, assessmentToken: "." };
  for (const call of [() => c.getProfile({ ...read, vacancyId: "../" }), () => c.mintLink({ ...target, invitationId: "../" }), () => c.getAssessment(bad), () => c.putAnswer({ access: "public", assessmentToken: "opaque", position: 64, body: { event_id: id, value: 3 } })]) expect(await call()).toEqual({ ok: false, reason: "invalid_request", reference: {} });
  expect(await c.getProfile({ ...read, token: " " })).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await c.saveProfile({ ...read, ifMatch: "", body })).toEqual({ ok: false, reason: "precondition_required", reference: {} });
  expect(await c.saveProfile({ ...read, ifMatch: "bad", body })).toEqual({ ok: false, reason: "invalid_request", reference: {} });
  expect(await c.saveProfile({ ...read, ifMatch: etag, body: { ...body, version: "1" } })).toEqual({ ok: false, reason: "validation_error", reference: {} });
  expect(await c.deleteAnswer({ access: "public", assessmentToken: "opaque", position: 1, body: { event_id: id, changes: 1 } })).toEqual({ ok: false, reason: "validation_error", reference: {} });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed success, missing etag and unexpected 2xx", async () => {
  for (const [call, payload, status] of [[() => c.getProfile(read), profile, 200], [() => c.getItems({ access: "public", assessmentToken: "opaque" }), {}, 200], [() => c.deleteAnswer({ access: "public", assessmentToken: "opaque", position: 1, body: { event_id: id } }), {}, 200]] as const) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status })));
    expect(await call()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  }
});
it("keeps opaque public tokens encoded in one path segment without bearer credentials", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(base))); vi.stubGlobal("fetch", fetch);
  expect(await c.getAssessment({ access: "public", assessmentToken: "a/b+c=" })).toEqual({ ok: true, data: base });
  expect(String(fetch.mock.calls[0][0])).toBe("http://localhost:8080/v2/assessments/a%2Fb%2Bc%3D");
  expect(new Headers(fetch.mock.calls[0][1].headers).has("authorization")).toBe(false);
});
it("never reflects untrusted codes or oversized error text containing the public token", async () => {
  for (const payload of [{ error: "public_secret-token", code: "public_secret-token" }, { error: "public_secret-token".repeat(1000), code: "notice_changed" }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 409 })));
    expect(await c.getAssessment({ access: "public", assessmentToken: "public_secret-token" })).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 409 } });
  }
});
