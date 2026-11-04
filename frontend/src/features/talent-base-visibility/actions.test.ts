import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadTalentBaseVisibilityAction, saveTalentBaseVisibilityAction } from "./actions";
import { anaId, luisId, martaId, ownerId, selectedByAna, visibility } from "./test-fixtures";

const URL_ = "https://api.example.test/v2/me/company/talent-base-visibility";
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => { vi.unstubAllGlobals(); });
const save = (input: { mode: "all_recruiters" | "selected_users"; userIds: string[]; version: number }) => saveTalentBaseVisibilityAction(input);
const envelope = (status: number, code: string, fields?: { field: string; code: string }[]) =>
  Response.json({ error: "private backend message", code, ...(fields ? { fields } : {}) }, { status });

it("reads the strict document over authenticated no-store transport", async () => {
  fetchMock.mockResolvedValue(Response.json(selectedByAna));
  expect(await loadTalentBaseVisibilityAction()).toEqual({ ok: true, document: selectedByAna });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe(URL_);
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(init.method ?? "GET").toBe("GET");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("decodes the never-saved document where updated_at and updated_by are null", async () => {
  const neverSaved = visibility({ updated_at: null, updated_by: null });
  fetchMock.mockResolvedValue(Response.json(neverSaved));
  expect(await loadTalentBaseVisibilityAction()).toEqual({ ok: true, document: neverSaved });
  fetchMock.mockResolvedValue(Response.json(neverSaved, { status: 412 }));
  expect(await save({ mode: "selected_users", userIds: [], version: 2 })).toMatchObject({ ok: false, reason: "version_conflict", document: neverSaved });
});

it("rejects an unrecognized document instead of rendering it", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...visibility(), mode: "everyone" }));
  expect(await loadTalentBaseVisibilityAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockResolvedValue(Response.json({ ...visibility(), extra: true }));
  expect(await loadTalentBaseVisibilityAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("PUTs the replacing body with If-Match derived from the version and returns the new document", async () => {
  const next = visibility({ mode: "selected_users", version: 4, viewers: selectedByAna.viewers });
  fetchMock.mockResolvedValue(Response.json(next, { headers: { etag: '"4"' } }));
  expect(await save({ mode: "selected_users", userIds: [anaId, luisId], version: 3 })).toEqual({ ok: true, document: next });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe(URL_);
  expect(init).toMatchObject({ method: "PUT", cache: "no-store", redirect: "error", body: JSON.stringify({ mode: "selected_users", user_ids: [anaId, luisId] }) });
  const headers = new Headers(init.headers);
  expect(headers.get("if-match")).toBe('"3"');
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("authorization")).toBe("Bearer private-token");
});

it("accepts selected_users with an empty list (D1) and sends an empty list for all_recruiters", async () => {
  fetchMock.mockImplementation(async () => Response.json(visibility({ mode: "selected_users", version: 2 })));
  expect((await save({ mode: "selected_users", userIds: [], version: 1 })).ok).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toStrictEqual({ mode: "selected_users", user_ids: [] });
  // Stale picker selections never travel with the default mode: the backend would answer users_not_applicable.
  expect((await save({ mode: "all_recruiters", userIds: [anaId], version: 2 })).ok).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toStrictEqual({ mode: "all_recruiters", user_ids: [] });
});

it("returns the current document on a version conflict (412) and nothing else from the body", async () => {
  fetchMock.mockResolvedValue(Response.json(selectedByAna, { status: 412, headers: { etag: '"3"' } }));
  const result = await save({ mode: "all_recruiters", userIds: [], version: 2 });
  expect(result).toEqual({ ok: false, reason: "version_conflict", document: selectedByAna, reference: { status: 412 } });
});

it("returns the current document from the backend's 412 body, which adds error and code to the GET keys", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...selectedByAna, error: "talent base visibility changed", code: "talent_base_visibility_version_conflict" }, { status: 412, headers: { etag: '"3"' } }));
  const result = await save({ mode: "all_recruiters", userIds: [], version: 2 });
  expect(result).toEqual({ ok: false, reason: "version_conflict", document: selectedByAna, reference: { status: 412, code: "talent_base_visibility_version_conflict" } });
});

it("reports a version conflict without a document when the body is an envelope", async () => {
  fetchMock.mockResolvedValue(envelope(412, "talent_base_visibility_version_conflict"));
  const result = await save({ mode: "all_recruiters", userIds: [], version: 2 });
  expect(result).toEqual({ ok: false, reason: "version_conflict", reference: { status: 412, code: "talent_base_visibility_version_conflict" } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("maps validation_error fields: mode, user_ids and user_ids[i] back to the submitted ids", async () => {
  fetchMock.mockResolvedValue(envelope(400, "validation_error", [{ field: "mode", code: "required" }, { field: "user_ids", code: "invalid" }, { field: "user_ids[1]", code: "duplicate" }, { field: "user_ids[9]", code: "duplicate" }]));
  const result = await save({ mode: "selected_users", userIds: [anaId, luisId, martaId], version: 1 });
  expect(result).toEqual({ ok: false, reason: "validation_error", fields: ["mode", "user_ids"], userIds: [luisId], reference: { status: 400, code: "validation_error" } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it.each([["talent_base_viewer_not_member", "viewer_not_member"], ["talent_base_viewer_is_owner", "viewer_is_owner"]] as const)("maps %s with the offending submitted ids", async (code, reason) => {
  fetchMock.mockResolvedValue(envelope(422, code, [{ field: "user_ids[2]", code: "invalid" }, { field: "user_ids[0]", code: "invalid" }]));
  expect(await save({ mode: "selected_users", userIds: [anaId, luisId, martaId], version: 1 })).toEqual({ ok: false, reason, userIds: [martaId, anaId], reference: { status: 422, code } });
});

it("maps talent_base_users_not_applicable", async () => {
  fetchMock.mockResolvedValue(envelope(422, "talent_base_users_not_applicable", [{ field: "user_ids", code: "invalid" }]));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "users_not_applicable", reference: { status: 422, code: "talent_base_users_not_applicable" } });
});

it("keeps validation_error (HTTP 400) apart from the generic 400 invalid_request and from a 422 validation_error", async () => {
  fetchMock.mockResolvedValueOnce(envelope(400, "invalid_request"));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "invalid_request", reference: { status: 400, code: "invalid_request" } });
  // The contract puts validation_error at 400; a 422 with that code is not part of it.
  fetchMock.mockResolvedValueOnce(envelope(422, "validation_error", [{ field: "mode", code: "required" }]));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it.each([[403, "forbidden", "forbidden"], [401, "unauthenticated", "unauthenticated"], [428, "precondition_required", "invalid_request"], [400, "invalid_request", "invalid_request"], [500, "internal_error", "server_error"]] as const)("classifies HTTP %s %s as %s without raw messages", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code));
  const result = await save({ mode: "all_recruiters", userIds: [], version: 1 });
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("classifies an unknown 422 code and a malformed body as unrecognized, and transport failures as no_response", async () => {
  fetchMock.mockResolvedValueOnce(envelope(422, "something_new"));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockResolvedValueOnce(Response.json({ ...visibility(), mode: "weird" }));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockRejectedValueOnce(new Error("boom"));
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "no_response" });
});

it("never reaches the network without a session or with unsafe input", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValueOnce(null);
  expect(await loadTalentBaseVisibilityAction()).toMatchObject({ ok: false, reason: "unauthenticated" });
  vi.mocked(getActionAccessToken).mockResolvedValueOnce("  ");
  expect(await save({ mode: "all_recruiters", userIds: [], version: 1 })).toMatchObject({ ok: false, reason: "unauthenticated" });
  for (const input of [
    { mode: "selected_users", userIds: ["../x"], version: 1 }, { mode: "bogus", userIds: [], version: 1 },
    { mode: "selected_users", userIds: [ownerId, ownerId], version: 1 }, { mode: "selected_users", userIds: [], version: 0 },
    { mode: "selected_users", userIds: [], version: 1.5 },
  ] as const) expect(await save(input as never)).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(fetchMock).not.toHaveBeenCalled();
});
