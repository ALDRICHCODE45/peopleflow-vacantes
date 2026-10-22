// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/identity/me-client", () => ({ loadMe: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 20 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { GET, POST } from "./route";
import { detailFixture } from "@/features/org-candidates/detail/test-fixtures";
import { HARD_MAX_BYTES } from "@/features/candidate-cvs/model";
const makeForm = () => { const form = new FormData(); form.append("cv", new File(["%PDF-test"], "corrected.pdf", { type: "application/pdf" })); return form; };
const upload = (body: BodyInit = makeForm(), headers: HeadersInit = { "If-Match": '\"v1\"' }) => POST(new Request("http://localhost/api/company/candidates/cv", { method: "POST", body, headers }), { params: Promise.resolve({ kind: "manual", id: candidateId, participationId }) });
it("POST forwards only multipart cv and If-Match, returning the new detail without leaking headers", async () => {
 const data = { ...detailFixture(), id: candidateId, etag: '\"v2\"' }; data.participations[0].id = participationId;
 const fetch = vi.fn().mockResolvedValue(Response.json(data, { headers: { etag: data.etag, "set-cookie": "private" } })); vi.stubGlobal("fetch", fetch);
 const response = await upload(); expect(response.status).toBe(200); expect(await response.json()).toEqual(data);
 expect(response.headers.get("etag")).toBe(data.etag); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.has("set-cookie")).toBe(false);
 expect(fetch).toHaveBeenCalledTimes(1); const init = fetch.mock.calls[0][1];
 expect(init.body.get("cv").name).toBe("corrected.pdf"); expect(await init.body.get("cv").text()).toBe("%PDF-test"); expect([...init.body.keys()]).toEqual(["cv"]);
 expect(new Headers(init.headers).get("if-match")).toBe('\"v1\"');
});
it.each([[412, "precondition_failed"], [428, "precondition_required"], [400, "validation_error"], [413, "cv_too_large"]] as const)("POST sanitizes upstream %s", async (status, code) => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private raw message", code }, { status })));
 const response = await upload(); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code, code });
});
it("POST rejects cross-origin, malformed headers and unexpected parts before transport", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect((await upload(makeForm(), { origin: "https://evil.test", "If-Match": '\"v1\"' })).status).toBe(403);
 expect((await upload(makeForm(), { "sec-fetch-site": "cross-site", "If-Match": '\"v1\"' })).status).toBe(403);
 expect((await upload(makeForm(), {})).status).toBe(428);
 expect((await upload(makeForm(), { "If-Match": "bad" })).status).toBe(400);
 expect((await upload(makeForm(), { "If-Match": '\"v1\"', "content-length": "wrong" })).status).toBe(400);
 const form = makeForm(); form.append("unexpected", "private"); expect((await upload(form)).status).toBe(400);
 const repeated = makeForm(); repeated.append("cv", "second"); expect((await upload(repeated)).status).toBe(400);
 expect((await upload(new FormData())).status).toBe(400);
 expect((await upload("not multipart")).status).toBe(400);
 expect(fetch).not.toHaveBeenCalled();
});
it("POST bounds actual bytes even without Content-Length and rejects empty/unsupported files", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 const oversized = new Uint8Array(HARD_MAX_BYTES + 65_537);
 expect((await upload(oversized, { "If-Match": '\"v1\"', "content-type": "multipart/form-data; boundary=test" })).status).toBe(413);
 const form = new FormData(); form.append("cv", new File([], "empty.pdf", { type: "application/pdf" })); expect((await upload(form)).status).toBe(400);
 const doc = new FormData(); doc.append("cv", new File(["doc"], "old.doc", { type: "application/msword" })); expect((await upload(doc)).status).toBe(415);
 expect(fetch).not.toHaveBeenCalled();
});
it("POST validates the file budget separately from the multipart envelope", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 const form = new FormData(); form.append("cv", new File([new Uint8Array(HARD_MAX_BYTES + 1)], "large.pdf", { type: "application/pdf" }));
 expect((await upload(form)).status).toBe(413);
 expect((await upload(makeForm(), { "If-Match": '\"v1\"', "content-length": String(HARD_MAX_BYTES + 65_537) })).status).toBe(413);
 expect(fetch).not.toHaveBeenCalled();
});
it("POST requires a session and recruiter role", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 vi.mocked(getActionAccessToken).mockResolvedValue(null); expect((await upload()).status).toBe(401);
 vi.mocked(getActionAccessToken).mockResolvedValue("token"); vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "candidate", user: { id: candidateId, email: "test@example.com", full_name: "Candidate" } } });
 expect((await upload()).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
});
const candidateId = "123e4567-e89b-42d3-a456-426614174000", participationId = "123e4567-e89b-42d3-a456-426614174001";
const call = (kind = "manual", id = candidateId, participation = participationId) => GET(new Request("http://localhost/api/company/candidates/cv", { headers: { cookie: "private-cookie" } }), { params: Promise.resolve({ kind, id, participationId: participation }) });
beforeEach(() => {
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "recruiter", user: { id: candidateId, email: "test@example.com", full_name: "Recruiter" } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"])("streams the %s candidate's participation CV, no-store, with only the server Bearer upstream", async kind => {
  const fetch = vi.fn().mockResolvedValue(new Response("%PDF-file", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Ana.pdf"', "set-cookie": "private-cookie" } })); vi.stubGlobal("fetch", fetch);
  const response = await call(kind); expect(response.status).toBe(200); expect(await response.text()).toBe("%PDF-file");
  expect(Object.fromEntries(response.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/pdf", "content-disposition": 'attachment; filename="Ana.pdf"', "x-content-type-options": "nosniff" });
  expect(fetch).toHaveBeenCalledTimes(1); const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(`http://localhost:8080/v2/me/company/candidates/${kind}/${candidateId}/participations/${participationId}/cv`);
  expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" }); expect(Object.fromEntries(new Headers(init.headers))).toEqual({ authorization: "Bearer private-token" });
});
it.each([["other", candidateId, participationId], ["manual", "bad", participationId], ["manual", candidateId, "bad"], ["organic", candidateId + "\n", participationId]])("validates kind and both UUIDs before transport: %s %s %s", async (kind, id, participation) => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const response = await call(kind, id, participation);
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not_found", code: "not_found" }); expect(fetch).not.toHaveBeenCalled();
});
it.each([[503, "cv_storage_unavailable"], [404, "not_found"], [401, "unauthenticated"], [403, "forbidden"]] as const)("returns a safe JSON envelope for %s %s", async (status, code) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private-token private-cookie", code }, { status, headers: { "set-cookie": "private-cookie" } })); vi.stubGlobal("fetch", fetch);
  const response = await call(); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code, code }); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.has("set-cookie")).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not access the backend without a session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await call(); expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "unauthenticated", code: "unauthenticated" }); expect(fetch).not.toHaveBeenCalled();
});
it("rejects candidate sessions without requesting the attachment", async () => {
  vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "candidate", user: { id: candidateId, email: "test@example.com", full_name: "Candidate" } } });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect((await call()).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
});
it("rejects unsafe attachment responses and strips arbitrary errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-token", { headers: { "content-type": "text/html" } })));
  const response = await call(); expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "unrecognized_response", code: "unrecognized_response" });
});
