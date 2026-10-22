import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/identity/me-client", () => ({ loadMe: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 100 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { id } from "@/features/org-candidates/detail/test-fixtures";
import { GET } from "./route";
const call = (kind = "manual", candidateId = id(1), participationId = id(2)) => GET(new Request("http://localhost/api/company/candidates/cv/original"), { params: Promise.resolve({ kind, id: candidateId, participationId }) });
beforeEach(() => {
 vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
 vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "recruiter", user: { id: id(6), email: "test@example.com", full_name: "Recruiter" } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"])("streams the %s original through the pool authorization boundary", async kind => {
 const fetch = vi.fn().mockResolvedValue(new Response("%PDF-original", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="original.pdf"', "set-cookie": "private" } })); vi.stubGlobal("fetch", fetch);
 const response = await call(kind); expect(response.status).toBe(200); expect(await response.text()).toBe("%PDF-original");
 expect(String(fetch.mock.calls[0][0])).toBe(`http://localhost:8080/v2/me/company/candidates/${kind}/${id(1)}/participations/${id(2)}/cv/original`);
 expect(Object.fromEntries(new Headers(fetch.mock.calls[0][1].headers))).toEqual({ authorization: "Bearer private-token" });
 expect(Object.fromEntries(response.headers)).toEqual({ "cache-control": "no-store", "content-type": "application/pdf", "content-disposition": 'attachment; filename="original.pdf"', "x-content-type-options": "nosniff" });
});
it("validates all path parts, session and role without transport", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect((await call("other")).status).toBe(404); expect((await call("manual", "../bad")).status).toBe(404); expect((await call("manual", id(1), "../bad")).status).toBe(404);
 vi.mocked(getActionAccessToken).mockResolvedValue(null); expect((await call()).status).toBe(401);
 vi.mocked(getActionAccessToken).mockResolvedValue("token"); vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "candidate", user: { id: id(6), email: "test@example.com", full_name: "Candidate" } } });
 expect((await call()).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
});
it("returns safe 404 and rejects unsafe responses", async () => {
 const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "private", code: "not_found" }, { status: 404 })).mockResolvedValueOnce(new Response("private", { headers: { "content-type": "text/html" } })); vi.stubGlobal("fetch", fetch);
 const missing = await call(); expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: "not_found", code: "not_found" });
 expect((await call()).status).toBe(502);
});
