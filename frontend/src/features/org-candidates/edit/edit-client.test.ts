import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { saveOrgCandidateEditAction } from "./edit-actions";
import { editFixture } from "./test-fixtures";
const body = { set: { professional_title: "Ingeniera" } };
beforeEach(() => vi.mocked(getActionAccessToken).mockResolvedValue("private-token"));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"] as const)("PATCHes %s with JSON and If-Match and parses the full detail", async kind => {
 const candidate = editFixture(kind); const data = { ...candidate, etag: '"v2"' };
 const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetch);
 expect(await saveOrgCandidateEditAction(candidate, candidate.etag, body)).toEqual({ ok: true, data });
 expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/v2/me/company/candidates/${kind}/${candidate.id}`);
 const init = fetch.mock.calls[0][1];
 expect(init).toMatchObject({ method: "PATCH", cache: "no-store", redirect: "error", body: JSON.stringify(body) });
 const headers = new Headers(init.headers);
 expect(headers.get("if-match")).toBe(candidate.etag); expect(headers.get("content-type")).toBe("application/json"); expect(headers.get("authorization")).toBe("Bearer private-token");
});
it.each([[412, "precondition_failed"], [428, "precondition_required"], [404, "not_found"], [401, "unauthenticated"], [403, "forbidden"]] as const)("maps HTTP %s without raw messages", async (status, code) => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private detail", code }, { status })));
 const result = await saveOrgCandidateEditAction(editFixture(), '"v1"', body);
 expect(result).toMatchObject({ ok: false, reason: code, reference: { status, code } }); expect(JSON.stringify(result)).not.toContain("private detail");
});
it("passes validation paths and rejects malformed detail", async () => {
 const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "private", code: "validation_error", fields: [{ field: "education[0].status", code: "required" }] }, { status: 400 })).mockResolvedValueOnce(Response.json({ secret: "private" })); vi.stubGlobal("fetch", fetch);
 expect(await saveOrgCandidateEditAction(editFixture(), '"v1"', body)).toMatchObject({ ok: false, reason: "validation_error", fields: [{ field: "education[0].status", code: "required" }] });
 expect(await saveOrgCandidateEditAction(editFixture(), '"v1"', body)).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it("rejects unsafe identities, invalid etags, empty bodies and manual resets without transport", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 for (const [identity, etag, patch] of [[{ ...editFixture(), id: "../other" }, '"v1"', body], [editFixture(), "bad", body], [editFixture(), '"v1"', { set: {}, reset: [] }], [editFixture(), '"v1"', { set: {}, reset: ["phone"] }]] as const) {
  expect((await saveOrgCandidateEditAction(identity, etag, { ...patch, reset: "reset" in patch ? [...patch.reset] : undefined })).ok).toBe(false);
 }
 expect(fetch).not.toHaveBeenCalled();
});
it("never sends an empty reset list, which the backend rejects on manual records (QA L12)", async () => {
 const candidate = editFixture("manual"); const fetch = vi.fn().mockResolvedValue(Response.json({ ...candidate, etag: '"v2"' })); vi.stubGlobal("fetch", fetch);
 expect((await saveOrgCandidateEditAction(candidate, candidate.etag, { set: { skills: ["Go"] }, reset: [] })).ok).toBe(true);
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toStrictEqual({ set: { skills: ["Go"] } });
});
