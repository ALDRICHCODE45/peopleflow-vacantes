import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { postCandidateContacts } from "./contacts-client";
const candidate = { kind: "organic" as const, id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e" };
const contact = { ...candidate, email: "corrected@example.test", phone: null };
afterEach(() => vi.unstubAllGlobals());
it("POSTs bounded identities through the no-store, authorized, redirect-guarded transport", async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [contact] }))); vi.stubGlobal("fetch", fetch);
 expect(await postCandidateContacts({ token: " token ", candidates: [candidate] })).toEqual({ ok: true, data: { items: [contact] } });
 const [url, init] = fetch.mock.calls[0];
 expect(url).toBe("http://localhost:8080/v2/me/company/candidates/contacts");
 expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error", body: JSON.stringify({ candidates: [candidate] }) });
 expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
 expect(new Headers(init.headers).get("content-type")).toBe("application/json");
});
it.each([[], [candidate, candidate], [{ ...candidate, extra: true }], [{ ...candidate, id: "invalid" }], Array.from({ length: 101 }, () => candidate)].map(candidates => ({ candidates })))("rejects invalid bodies before transport %#", async ({ candidates }) => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect(await postCandidateContacts({ token: "token", candidates })).toMatchObject({ ok: false });
 expect(fetch).not.toHaveBeenCalled();
});
it("rejects a blank token before transport", async () => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect(await postCandidateContacts({ token: " ", candidates: [candidate] })).toMatchObject({ ok: false });
 expect(fetch).not.toHaveBeenCalled();
});
it.each([
 { items: [{ ...contact, extra: true }] }, { items: [{ ...contact, email: undefined }] }, { items: [{ ...contact, phone: 1 }] },
 { items: [contact, contact] }, { items: [{ ...contact, kind: "manual" }] }, { items: [], extra: true },
])("strictly rejects malformed or unrequested contacts %#", async body => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
 expect(await postCandidateContacts({ token: "token", candidates: [candidate] })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it("allows omitted pool identities without inventing contacts", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"items":[]}')));
 expect(await postCandidateContacts({ token: "token", candidates: [candidate] })).toEqual({ ok: true, data: { items: [] } });
});
it.each([201, 204])("rejects unexpected success status %s", async status => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : '{"items":[]}', { status })));
 expect(await postCandidateContacts({ token: "token", candidates: [candidate] })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([400, 401, 403, 500])("never retries HTTP %s failures or exposes contact", async status => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private", code: "internal_error" }), { status })));
 expect(await postCandidateContacts({ token: "token", candidates: [candidate] })).toMatchObject({ ok: false, error: { retryable: false, status } });
});
