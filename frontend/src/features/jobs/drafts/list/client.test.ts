import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({ get serverEnv() { env.reads++; return { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 }; } }));
const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const row = { id, title: "Analista", work_mode: null, work_schedule: null, requester: { kind: "client", id, name: "Acme" }, principal_recruiter: { id, name: "Ana" }, version: "9007199254740993", created_at: "2026-10-15T12:00:00Z", updated_at: "2026-10-15T06:30:00-06:00" };
function response(body: unknown, status = 200) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => { vi.unstubAllGlobals(); env.reads = 0; });
it.each([
 row, ...["onsite", "remote", "hybrid"].map(work_mode => ({ ...row, work_mode })),
 ...["full_time", "part_time"].map(work_schedule => ({ ...row, work_schedule })), { ...row, title: null }, { ...row, requester: null },
 { ...row, requester: { kind: "internal_area", id: null, name: null } },
 { ...row, principal_recruiter: { id, name: null } },
])("accepts S2 row %# without rewriting", async item => {
 const { listDrafts } = await import("./client");
 response({ items: [item], next_cursor: null });
 expect(await listDrafts({ token: "secret" })).toEqual({ ok: true, data: { items: [item], next_cursor: null } });
});
it.each([
 { ...row, requester: { kind: "client", id, name: null } },
 { ...row, work_mode: undefined }, { ...row, work_schedule: undefined },
 { ...row, work_mode: "elsewhere" }, { ...row, work_schedule: "contract" },
 { ...row, extra: true }, { ...row, id: "bad" },
 { ...row, principal_recruiter: { id: "bad", name: null } },
 { ...row, requester: { kind: "client", id, name: "Acme", extra: true } },
 { ...row, principal_recruiter: { id, name: "Ana", extra: true } },
 { ...row, version: "0" }, { ...row, version: "01" }, { ...row, version: 1 },
 { ...row, created_at: "2026-10-15" }, { ...row, updated_at: "not a date" },
 { ...row, id: `${id}\n` }, { ...row, version: "7\n" },
])("rejects malformed row %#", async item => {
 const { listDrafts } = await import("./client"); response({ items: [item], next_cursor: null });
 expect(await listDrafts({ token: "secret" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it("passes opaque cursor encoded, limit, Bearer only and no-store to the v2 root", async () => {
 const { listDrafts } = await import("./client"); const cursor = " a+/=&?ñ ";
 const fetch = response({ items: [], next_cursor: cursor });
 expect(await listDrafts({ token: " secret ", cursor, limit: 50 })).toMatchObject({ ok: true, data: { next_cursor: cursor } });
 expect(fetch).toHaveBeenCalledTimes(1);
 const [url, init] = fetch.mock.calls[0];
 expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts?limit=50&cursor=${new URLSearchParams({ cursor }).toString().slice(7)}`);
 expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
 expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer secret" });
});
it.each([{ token: " " }, { token: "x", limit: 0 }, { token: "x", limit: 51 }, { token: "x", limit: 1.5 }])("guards before env/fetch %#", async input => {
 const { listDrafts } = await import("./client"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect((await listDrafts(input)).ok).toBe(false); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
});
it("rejects unknown envelope keys", async () => {
 const { listDrafts } = await import("./client"); response({ items: [], next_cursor: null, extra: true });
 expect(await listDrafts({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([[400,"invalid_request"], [401,"unauthenticated"], [403,"forbidden"], [403,"company_inactive"], [409,"company_not_active"], [500,"internal_error"]] as const)("preserves %s %s without retry", async (status, code) => {
 const { listDrafts } = await import("./client"); const fetch = response({ error: "Unsafe", code }, status);
 expect(await listDrafts({ token: "x" })).toMatchObject({ ok: false, error: { status, retryable: false }, envelope: { code } }); expect(fetch).toHaveBeenCalledTimes(1);
});
