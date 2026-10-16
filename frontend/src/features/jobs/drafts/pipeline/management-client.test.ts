import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({ get serverEnv() { env.reads++; return { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 }; } }));
import { getDraftManagement, saveDraftManagement } from "./management-client";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const etag = '"opaque-management+/="';
const management = { version: "0", requestDate: null, hiringHeadcount: null, limits: { maxHiringHeadcount: 999 }, today: "2026-10-16" };
const body = { requestDate: "2026-10-10", hiringHeadcount: 5 };
function response(data: unknown, status = 200, tag: string | null = etag) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers: tag === null ? {} : { etag: tag } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); env.reads = 0; });
for (const method of ["GET", "PUT"] as const) describe(method, () => {
  const call = () => method === "GET" ? getDraftManagement({ token: " secret ", draftId }) : saveDraftManagement({ token: " secret ", draftId, ifMatch: etag, body });
  it("uses the independent v2 resource, bearer-only no-store, exact body and opaque ETag", async () => {
    const fetch = response(management); expect(await call()).toEqual({ ok: true, data: management, etag }); expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]; expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts/${draftId}/management`);
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" }); expect(init.method ?? "GET").toBe(method);
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer secret", ...(method === "PUT" ? { "content-type": "application/json", "if-match": etag } : {}) });
    expect(init.body).toBe(method === "PUT" ? JSON.stringify(body) : undefined);
  });
  it.each(["0", "1", "90071992547409931234567890"])("preserves decimal version %s", async version => { const data = { ...management, version }; response(data); expect(await call()).toEqual({ ok: true, data, etag }); });
  it("accepts populated fields and a real leap day", async () => { const data = { ...management, ...body, requestDate: "2024-02-29" }; response(data); expect(await call()).toEqual({ ok: true, data, etag }); });
  it.each([null, "", "   "])("requires ETag %j", async tag => { response(management, 200, tag); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
  it.each([
    { ...management, extra: true }, ...["01", "-1", "1.0", "1\n", 1, undefined].map(version => ({ ...management, version })),
    ...[1.5, "5", undefined].map(hiringHeadcount => ({ ...management, hiringHeadcount })),
    ...["requestDate", "today"].flatMap(key => ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "2026-10-16\n", "0000-01-01", undefined].map(value => ({ ...management, [key]: value }))),
    { ...management, today: null },
    ...[0, -1, 1.5, "999", undefined].map(maxHiringHeadcount => ({ ...management, limits: { maxHiringHeadcount } })),
    { ...management, limits: { ...management.limits, extra: true } }, { ...management, limits: null },
  ])("rejects strict malformed response %#", async data => { response(data); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
  it.each([201, 202])("requires 200 not %s", async status => { response(management, status); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response" } }); });
  it.each([[400,"validation_error"],[400,"invalid_request"],[412,"version_conflict"],[500,"internal_error"]])("preserves %s %s without retry", async (status, code) => {
    const envelope = { error: "unsafe", code }; const fetch = response(envelope, Number(status)); expect(await call()).toMatchObject({ ok: false, error: { status, retryable: false }, envelope }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("decodes publication_incomplete missing codes without retry", async () => {
    const envelope = { error: "unsafe", code: "publication_incomplete", missing: ["hiring_headcount_missing", "future"] };
    const fetch = response(envelope, 422);
    expect(await call()).toEqual({ ok: false, error: { kind: "status", status: 422, retryable: false }, envelope });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { error: "unsafe", code: "publication_incomplete" },
    { error: "unsafe", code: "publication_incomplete", missing: [""] },
    { error: "unsafe", code: "publication_incomplete", missing: [" "] },
    { error: "unsafe", code: "publication_incomplete", missing: [1] },
    { error: "unsafe", code: "publication_incomplete", missing: null },
    { error: "unsafe", code: "publication_incomplete", missing: ["title_missing"], extra: true },
    { code: "publication_incomplete", missing: ["title_missing"] },
    { error: "unsafe", code: "other", missing: ["title_missing"] },
  ])("rejects malformed publication envelope %#", async envelope => {
    response(envelope, 422);
    expect(await call()).toEqual({ ok: false, error: { kind: "status", status: 422, retryable: false } });
  });
  it("rejects malformed envelope", async () => { response({ error: "unsafe", code: "invalid_request", details: true }, 400); expect(await call()).toEqual({ ok: false, error: { kind: "status", status: 400, retryable: false } }); });
  it("never retries network failure", async () => { const fetch = vi.fn().mockRejectedValue(new Error("unsafe")); vi.stubGlobal("fetch", fetch); expect(await call()).toEqual({ ok: false, error: { kind: "network", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1); });
  it("never retries timeout", async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    vi.stubGlobal("fetch", fetch); const pending = call(); await vi.advanceTimersByTimeAsync(8001); expect(await pending).toEqual({ ok: false, error: { kind: "timeout", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[" ",draftId,"missing_token"],["x","bad","invalid_request"],["x",`${draftId}\n`,"invalid_request"]])("guards before env/fetch %#", async (token, id, kind) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const result = method === "GET" ? await getDraftManagement({ token, draftId: id }) : await saveDraftManagement({ token, draftId: id, ifMatch: etag, body });
    expect(result).toEqual({ ok: false, error: { kind, retryable: false } }); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
  });
});
it.each([null, {}, { ...body, extra: true }, { requestDate: null }, { hiringHeadcount: null }, { ...body, hiringHeadcount: "5" }, { ...body, hiringHeadcount: 1.5 }, { ...body, requestDate: "2026-02-30" }])("guards invalid PUT %# before env", async invalidBody => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await saveDraftManagement({ token: "x", draftId, ifMatch: etag, body: invalidBody })).toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } }); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
});
it.each(["", "   "])("guards blank If-Match %j", async ifMatch => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await saveDraftManagement({ token: "x", draftId, ifMatch, body })).toMatchObject({ ok: false, error: { kind: "invalid_request" } }); expect(env.reads).toBe(0); expect(fetch).not.toHaveBeenCalled(); });
it("accepts nullable keys and leaves business validation/opaque If-Match to their owners", async () => { const fetch = response(management); const nullable = { requestDate: null, hiringHeadcount: null }; expect(await saveDraftManagement({ token: "x", draftId, ifMatch: "opaque", body: nullable })).toMatchObject({ ok: true }); expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(nullable)); });
