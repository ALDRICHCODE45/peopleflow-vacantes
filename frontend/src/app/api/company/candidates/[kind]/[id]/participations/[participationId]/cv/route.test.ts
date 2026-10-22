import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/identity/me-client", () => ({ loadMe: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 20 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { GET } from "./route";
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
