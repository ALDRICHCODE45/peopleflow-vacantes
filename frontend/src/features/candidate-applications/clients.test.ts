import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadScreening, submitApplication, loadApplications } from "./client";
import { loadScreeningAction, submitApplicationAction, loadApplicationsAction } from "./actions";
import { body, id, key, screening, submitted, page } from "./test-fixtures";
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("private-token"); });
afterEach(() => vi.unstubAllGlobals());
describe("candidate application contracts", () => {
  it.each(["paused", "closed"])("maps lifecycle screening and submit failures for %s", async availability => {
    const data = { id, title: "Backend Go", company: { id, name: "Acme" }, availability };
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error: "Unavailable", code: "vacancy_unavailable", data }, { status: 410 })));
    expect(await loadScreeningAction(id)).toMatchObject({ reason: "vacancy_unavailable", vacancy: data });
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error: "Unavailable", code: "vacancy_not_accepting_applications", data: { availability } }, { status: 409 })));
    expect(await submitApplicationAction(id, key, body)).toMatchObject({ reason: "vacancy_not_accepting_applications", availability });
    fetchMock.mockResolvedValue(Response.json(submitted, { status: 201, headers: { "Idempotency-Replayed": "true" } }));
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: true, data: submitted });
  });
  it.each([{}, { availability: "published" }, { company: { id, name: " " } }, { extra: true }])("rejects malformed screening availability %j", async patch => {
    const data = { id, title: "Backend Go", company: { id, name: "Acme" }, availability: "paused", ...patch };
    if (!Object.keys(patch).length) delete (data as Partial<typeof data>).id;
    fetchMock.mockResolvedValue(Response.json({ error: "Unavailable", code: "vacancy_unavailable", data }, { status: 410 }));
    expect(await loadScreeningAction(id)).toMatchObject({ reason: "unrecognized_response" });
  });
  it.each([{}, { availability: "published" }, { availability: "paused", extra: true }])("rejects malformed apply availability %j", async data => {
    fetchMock.mockResolvedValue(Response.json({ error: "Unavailable", code: "vacancy_not_accepting_applications", data }, { status: 409 }));
    expect(await submitApplicationAction(id, key, body)).toMatchObject({ reason: "unrecognized_response" });
  });
  it("loads public screening without credentials", async () => {
    fetchMock.mockResolvedValue(Response.json(screening));
    expect(await loadScreening(id)).toEqual({ ok: true, data: screening });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.example.test/v2/jobs/${id}/screening`);
    expect(fetchMock.mock.calls[0][1].headers.has("authorization")).toBe(false);
  });
  it.each([
    { ...screening, extra: true }, { ...screening, questionnaire_revision: "" },
    { ...screening, limits: { open_answer_max_length: 0 } },
    { ...screening, limits: { open_answer_max_length: 1.5 } },
    { ...screening, questions: [{ ...screening.questions[0], options: [] }] },
    { ...screening, questions: [{ ...screening.questions[1], options: null }] },
    { ...screening, questions: [{ ...screening.questions[0], type: "boolean" }] },
    { ...screening, questions: [screening.questions[0], screening.questions[0]] },
    { ...screening, questions: [{ ...screening.questions[1], options: [{ id, label: "A" }, { id, label: "B" }] }] },
  ])("rejects malformed screening %j", async value => {
    fetchMock.mockResolvedValue(Response.json(value));
    expect(await loadScreening(id)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it("accepts an empty questionnaire", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...screening, questions: [] }));
    expect(await loadScreening(id)).toMatchObject({ ok: true });
  });
  it("sends exact body, candidate credential and UUID key, expecting only 201", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(submitted, { status: 201 }));
    expect(await submitApplication({ token: "private-token", id, key, body })).toEqual({ ok: true, data: submitted });
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe(JSON.stringify(body));
    expect(init.headers.get("idempotency-key")).toBe(key);
    expect(init.headers.get("authorization")).toBe("Bearer private-token");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    fetchMock.mockResolvedValueOnce(Response.json(submitted));
    expect(await submitApplication({ token: "private-token", id, key, body })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it.each([{ ...submitted, extra: true }, { ...submitted, status: "in_review" }, { ...submitted, applied_at: "2026-02-30T12:00:00Z" }, { ...submitted, vacancy_id: key }])("rejects malformed 201 %j", async value => {
    fetchMock.mockResolvedValue(Response.json(value, { status: 201 }));
    expect(await submitApplication({ token: "private-token", id, key, body })).toMatchObject({ ok: false });
  });
  it("rejects unsafe input before fetch", async () => {
    for (const args of [{ id: "../x", key, body }, { id, key: "bad", body }, { id, key, body: { ...body, extra: true } }, { id, key, body: { ...body, answers: [{ question_id: id, text: "a", option_id: key }] } }])
      expect(await submitApplication({ token: "private-token", ...args })).toMatchObject({ ok: false });
    expect(await loadScreening("bad")).toMatchObject({ ok: false });
    expect(await loadApplications({ token: "private-token", query: { limit: 0 } })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["submitted", "in_process"])("accepts only the candidate-visible status %s", async status => {
    const data = { ...page, items: [{ ...page.items[0], status }] };
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadApplications({ token: "private-token" })).toEqual({ ok: true, data });
  });
  it.each([undefined, "2026-10-16T12:00:00Z", "2026-10-20T09:30:00Z", "2026-10-20T03:30:00-06:00", "2026-10-20T09:30:00.123456Z"])("accepts the optional last visible change updated_at %s", async updated_at => {
    const data = { ...page, items: [{ ...page.items[0], ...(updated_at && { updated_at }) }] };
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadApplications({ token: "private-token" })).toEqual({ ok: true, data });
  });
  it.each([null, "", "2026-02-30T12:00:00Z", "2026-03-05T09:30:00", "2020-01-01T00:00:00Z"])("rejects a malformed or pre-application updated_at %j", async updated_at => {
    fetchMock.mockResolvedValue(Response.json({ ...page, items: [{ ...page.items[0], updated_at }] }));
    expect(await loadApplications({ token: "private-token" })).toMatchObject({ ok: false });
  });
  it.each([undefined, null, "2026-10-16T12:00:00Z", "2026-10-18T09:00:00.123456Z", "2026-10-18T03:00:00-06:00"])("accepts the optional first visible response first_response_at %j", async first_response_at => {
    const data = { ...page, items: [{ ...page.items[0], updated_at: "2026-10-20T09:30:00Z", ...(first_response_at !== undefined && { first_response_at }) }] };
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadApplications({ token: "private-token" })).toEqual({ ok: true, data });
  });
  it.each(["", "2026-02-30T12:00:00Z", "2026-10-18T09:00:00", "2020-01-01T00:00:00Z", 0])("rejects a malformed or pre-application first_response_at %j", async first_response_at => {
    fetchMock.mockResolvedValue(Response.json({ ...page, items: [{ ...page.items[0], first_response_at }] }));
    expect(await loadApplications({ token: "private-token" })).toMatchObject({ ok: false });
  });
  it.each([["submitted", null, undefined], ["submitted", null, null], ["closed", "Gracias por tu interés.", null], ["closed", "Gracias por tu interés.", "2026-10-21T09:00:00.5Z"]])("accepts message_read_at for status %s, message %j, read %j", async (status, message, message_read_at) => {
    const data = { ...page, items: [{ ...page.items[0], status, message, ...(message_read_at !== undefined && { message_read_at }) }] };
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadApplications({ token: "private-token" })).toEqual({ ok: true, data });
  });
  it.each([[null, "2026-10-21T09:00:00Z"], ["Gracias por tu interés.", "2020-01-01T00:00:00Z"], ["Gracias por tu interés.", ""], ["Gracias por tu interés.", "2026-10-21T09:00:00"]])("rejects message_read_at without a message or malformed (message %j, read %j)", async (message, message_read_at) => {
    fetchMock.mockResolvedValue(Response.json({ ...page, items: [{ ...page.items[0], status: "closed", message, message_read_at }] }));
    expect(await loadApplications({ token: "private-token" })).toMatchObject({ ok: false });
  });
  it("still rejects any other unknown item key next to updated_at", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...page, items: [{ ...page.items[0], updated_at: "2026-10-20T09:30:00Z", stage: "entrevista" }] }));
    expect(await loadApplications({ token: "private-token" })).toMatchObject({ ok: false });
  });
  it("pages the candidate list with encoded opaque cursor", async () => {
    fetchMock.mockResolvedValue(Response.json(page));
    expect(await loadApplications({ token: "private-token", query: { cursor: "a+/=", limit: 10 } })).toEqual({ ok: true, data: page });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/v2/me/applications?cursor=a%2B%2F%3D&limit=10");
  });
  it.each([{ ...page, extra: true }, { ...page, next_cursor: "" }, { ...page, items: [{ ...page.items[0], status: "hired" }] }, { ...page, items: [{ ...page.items[0], vacancy: { id, title: "x", state: "open", private: true } }] }, { ...page, items: [{ ...page.items[0], vacancy: { id, title: "x" } }] }, { ...page, items: [{ ...page.items[0], vacancy: { id, title: "x", state: "paused" } }] }])("rejects malformed list %j", async value => {
    fetchMock.mockResolvedValue(Response.json(value));
    expect(await loadApplications({ token: "private-token" })).toMatchObject({ ok: false });
  });
});
describe("action failure boundary", () => {
  it("does not recognize 428 idempotency_key_required", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "private", code: "idempotency_key_required" }, { status: 428 }));
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 428, code: "idempotency_key_required" } });
  });
  it.each([403, 400])("maps wrong_role only with 403 (got %i), including the list", async status => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error: "private-token", code: "wrong_role" }, { status })));
    for (const result of [await submitApplicationAction(id, key, body), await loadApplicationsAction()])
      expect(result).toEqual({ ok: false, reason: status === 403 ? "wrong_role" : "unrecognized_response", reference: { status, code: "wrong_role" } });
  });
  it("does not require a session for public screening", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    fetchMock.mockResolvedValue(Response.json(screening));
    expect(await loadScreeningAction(id)).toMatchObject({ ok: true });
    expect(await loadApplicationsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  });
  it.each([[404, "not_found"], [409, "already_applied"], [409, "questionnaire_changed"], [422, "cv_unavailable"], [400, "invalid_request"], [409, "idempotency_conflict"], [400, "invalid_idempotency_key"], [400, "idempotency_key_required"], [401, "unauthenticated"], [403, "forbidden"], [500, "internal_error"]] as const)("maps %i %s", async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ error: "private-token", code }, { status }));
    const result = await submitApplicationAction(id, key, body);
    expect(result).toMatchObject({ ok: false, reason: status === 500 ? "server_error" : code });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("strictly exposes invalid_answers details only for that code", async () => {
    const details = [{ question_id: id, reason: "required" }];
    fetchMock.mockResolvedValue(Response.json({ error: "private", code: "invalid_answers", details }, { status: 422 }));
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: false, reason: "invalid_answers", reference: { status: 422, code: "invalid_answers" }, details });
    for (const invalid of [undefined, [], [{ question_id: id, reason: "unknown" }], [{ question_id: id, reason: "required", extra: true }]]) {
      fetchMock.mockResolvedValue(Response.json({ error: "private", code: "invalid_answers", details: invalid }, { status: 422 }));
      expect(await submitApplicationAction(id, key, body)).toMatchObject({ reason: "unrecognized_response" });
    }
    fetchMock.mockResolvedValue(Response.json({ error: "private", code: "cv_unavailable", details }, { status: 422 }));
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 422 } });
  });
  it("sanitizes unknown codes, session exceptions and network errors", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "secret", code: "secret" }, { status: 400 }));
    expect(await submitApplicationAction(id, key, body)).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 400 } });
    fetchMock.mockRejectedValue(new Error("secret"));
    expect(await loadScreeningAction(id)).toEqual({ ok: false, reason: "no_response", reference: {} });
    vi.mocked(getActionAccessToken).mockRejectedValue(new Error("secret"));
    expect(await loadApplicationsAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
  });
});
