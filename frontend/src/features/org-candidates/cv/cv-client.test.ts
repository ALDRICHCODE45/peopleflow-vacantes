import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/identity/me-client", () => ({ loadMe: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { saveOrgCandidateCvAction } from "./cv-actions";
import { uploadOrgCandidateCv } from "./cv-client";
import { detailFixture, id } from "../detail/test-fixtures";
import { HARD_MAX_BYTES } from "@/features/candidate-cvs/model";
const file = () => new File(["%PDF-test"], "corregido.pdf", { type: "application/pdf" });
const identity = { kind: "manual" as const, id: id(1) };
beforeEach(() => {
 vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
 vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "recruiter", user: { id: id(6), email: "test@example.com", full_name: "Recruiter" } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"] as const)("uploads %s multipart with candidate If-Match and server-only auth", async kind => {
 const data = { ...detailFixture(kind), etag: '"v2"' };
 const fetch = vi.fn().mockResolvedValue(Response.json(data, { headers: { etag: data.etag } })); vi.stubGlobal("fetch", fetch);
 expect(await saveOrgCandidateCvAction({ ...identity, kind }, id(2), '"v1"', file())).toEqual({ ok: true, data });
 const [url, init] = fetch.mock.calls[0];
 expect(String(url)).toBe(`http://localhost:8080/v2/me/company/candidates/${kind}/${id(1)}/participations/${id(2)}/cv`);
 expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
 expect(Object.fromEntries(new Headers(init.headers))).toEqual({ authorization: "Bearer private-token", "if-match": '"v1"' });
 expect(init.body).toBeInstanceOf(FormData); expect([...init.body.keys()]).toEqual(["cv"]);
 expect(init.body.get("cv").name).toBe("corregido.pdf");
});
it.each([[400, "validation_error"], [412, "precondition_failed"], [428, "precondition_required"], [404, "not_found"], [413, "cv_too_large"], [415, "cv_unsupported_type"], [400, "cv_content_mismatch"], [503, "cv_storage_unavailable"], [500, "internal_error"]] as const)("maps %s %s without exposing raw messages", async (status, code) => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private raw message", code, ...(code === "validation_error" ? { fields: [{ field: "cv", code: "required" }] } : {}) }, { status })));
 const result = await saveOrgCandidateCvAction(identity, id(2), '"v1"', file());
 expect(result).toMatchObject({ ok: false, reference: { status, code } });
 expect(JSON.stringify(result)).not.toContain("private raw message");
 expect(result).toHaveProperty("reason", code === "internal_error" ? "server_error" : code);
});
it("rejects identity, participation, etag and file errors before transport", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 const large = new File([new Uint8Array(HARD_MAX_BYTES + 1)], "large.pdf", { type: "application/pdf" });
 for (const [candidate, pid, etag, cv] of [[{ ...identity, id: "../bad" }, id(2), '"v1"', file()], [identity, "../bad", '"v1"', file()], [identity, id(2), "bad", file()], [identity, id(2), '"v1"', new File(["doc"], "old.doc", { type: "application/msword" })], [identity, id(2), '"v1"', large], [identity, id(2), '"v1"', new File([], "empty.pdf", { type: "application/pdf" })]] as const) {
  expect((await uploadOrgCandidateCv("private-token", candidate, pid, etag, cv)).ok).toBe(false);
 }
 expect(fetch).not.toHaveBeenCalled();
});
it.each(["", "application/octet-stream"])("accepts DOCX with advisory MIME %s", async type => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...detailFixture(), etag: '"v2"' })));
 expect((await uploadOrgCandidateCv("token", identity, id(2), '"v1"', new File(["bytes"], "cv.docx", { type }))).ok).toBe(true);
});
it("rejects malformed or mismatched success, unsafe error codes and unavailable sessions", async () => {
 const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...detailFixture(), id: id(99) })).mockResolvedValueOnce(Response.json(detailFixture(), { headers: { etag: '"other"' } })).mockResolvedValueOnce(Response.json({ error: "private", code: "private-secret" }, { status: 400 })); vi.stubGlobal("fetch", fetch);
 expect(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file())).toMatchObject({ ok: false, reason: "unrecognized_response" });
 expect(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file())).toMatchObject({ ok: false, reason: "unrecognized_response" });
 expect(JSON.stringify(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file()))).not.toContain("private");
 vi.mocked(getActionAccessToken).mockResolvedValue(null);
 expect(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file())).toMatchObject({ ok: false, reason: "unauthenticated" });
 vi.mocked(getActionAccessToken).mockResolvedValue("token"); vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "candidate", user: { id: id(6), email: "test@example.com", full_name: "Candidate" } } });
 expect(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file())).toMatchObject({ ok: false, reason: "forbidden" });
 expect(fetch).toHaveBeenCalledTimes(3);
});
it("does not treat an unexpected success status as a confirmed upload", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(detailFixture(), { status: 201 })));
 expect(await saveOrgCandidateCvAction(identity, id(2), '\"v1\"', file())).toMatchObject({ ok: false, reason: "unrecognized_response", reference: { status: 502 } });
});
it("maps a network failure without raw exceptions", async () => {
 vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private token")));
 expect(await saveOrgCandidateCvAction(identity, id(2), '"v1"', file())).toMatchObject({ ok: false, reason: "no_response" });
});
