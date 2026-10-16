import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({ get serverEnv() { env.reads++; return { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 }; } }));
import { getDraftSubstates, saveDraftSubstates } from "./substates-client";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const etag = '"opaque-substates+/="';
const catalog = { version: "0", substates: [{ id: draftId, name: "Entrevista" }], limits: { maxSubstates: 50, nameMaxLength: 40 }, suggestions: ["Pruebas"] };
const body = { substates: [{ id: draftId, name: "Uno" }, { name: "Dos" }] };
function response(data: unknown, status = 200, tag: string | null = etag) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers: tag === null ? {} : { etag: tag } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); env.reads = 0; });
for (const method of ["GET", "PUT"] as const) describe(method, () => {
  const call = () => method === "GET" ? getDraftSubstates({ token: " secret ", draftId }) : saveDraftSubstates({ token: " secret ", draftId, ifMatch: etag, body });
  it("uses the independent v2 resource, bearer-only no-store transport, exact body and opaque ETag", async () => {
    const fetch = response(catalog); expect(await call()).toEqual({ ok: true, data: catalog, etag });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts/${draftId}/pipeline/substates`);
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" }); expect(init.method ?? "GET").toBe(method);
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer secret", ...(method === "PUT" ? { "content-type": "application/json", "if-match": etag } : {}) });
    expect(init.body).toBe(method === "PUT" ? JSON.stringify(body) : undefined);
  });
  it.each(["0", "1", "90071992547409931234567890"])("preserves version %s and empty catalog", async version => {
    const data = { ...catalog, version, substates: [], suggestions: [] }; response(data); expect(await call()).toEqual({ ok: true, data, etag });
  });
  it.each([null, "", "   "])("requires ETag %j", async tag => { response(catalog, 200, tag); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
  it.each([
    { ...catalog, extra: true }, ...["01", "-1", "1.0", "1\n", 1].map(version => ({ ...catalog, version })),
    ...[{ id: "bad", name: "x" }, { id: `${draftId}\n`, name: "x" }, { id: draftId, name: 7 }, { id: draftId, name: "x", extra: true }].map(entry => ({ ...catalog, substates: [entry] })),
    { ...catalog, substates: null }, { ...catalog, suggestions: undefined }, { ...catalog, suggestions: null }, { ...catalog, suggestions: [1] },
    { ...catalog, limits: { ...catalog.limits, extra: true } },
    ...[0, -1, 1.5, "50"].map(maxSubstates => ({ ...catalog, limits: { ...catalog.limits, maxSubstates } })),
    ...[0, -1, 1.5, "40"].map(nameMaxLength => ({ ...catalog, limits: { ...catalog.limits, nameMaxLength } })),
  ])("rejects malformed response %#", async data => { response(data); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } }); });
  it.each([201, 202])("requires exactly 200 not %s", async status => { response(catalog, status); expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response" } }); });
  it.each([[400,"invalid_request"],[400,"validation_error"],[401,"unauthenticated"],[403,"forbidden"],[403,"company_inactive"],[404,"not_found"],[409,"company_not_active"],[412,"version_conflict"],[413,"payload_too_large"],[428,"precondition_required"],[500,"internal_error"]])("preserves %s %s without retry", async (status, code) => {
    const envelope = { error: "unsafe", code }; const fetch = response(envelope, Number(status));
    expect(await call()).toMatchObject({ ok: false, error: { status, retryable: false }, envelope }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ error: "unsafe", code: "invalid_request", details: "unsafe" }, { error: "", code: "x" }, { error: "unsafe", code: "" }])("rejects malformed envelope %#", async envelope => {
    response(envelope, 400); expect(await call()).toEqual({ ok: false, error: { kind: "status", status: 400, retryable: false } });
  });
  it("never retries network failure", async () => { const fetch = vi.fn().mockRejectedValue(new Error("unsafe")); vi.stubGlobal("fetch", fetch); expect(await call()).toEqual({ ok: false, error: { kind: "network", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1); });
  it("never retries timeout", async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    vi.stubGlobal("fetch", fetch); const pending = call(); await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toEqual({ ok: false, error: { kind: "timeout", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[" ",draftId,"missing_token"],["x","bad","invalid_request"],["x",`${draftId}\n`,"invalid_request"]])("guards before env/fetch %#", async (token, id, kind) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = method === "GET" ? await getDraftSubstates({ token, draftId: id }) : await saveDraftSubstates({ token, draftId: id, ifMatch: etag, body });
    expect(result).toEqual({ ok: false, error: { kind, retryable: false } }); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
  });
});
it.each([null, { ...body, extra: true }, {}, { substates: "bad" }, { substates: [{ id: null, name: "x" }] }, { substates: [{ id: "bad", name: "x" }] }, { substates: [{ name: 1 }] }, { substates: [{ name: "x", kind: "custom" }] }])("guards invalid PUT %# before env", async invalidBody => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await saveDraftSubstates({ token: "x", draftId, ifMatch: etag, body: invalidBody })).toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } }); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
});
it.each(["", "   "])("guards blank If-Match %j", async ifMatch => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await saveDraftSubstates({ token: "x", draftId, ifMatch, body })).toMatchObject({ ok: false, error: { kind: "invalid_request" } }); expect(env.reads).toBe(0); expect(fetch).not.toHaveBeenCalled();
});
it("leaves business validation and opaque If-Match to their owners", async () => {
  const fetch = response(catalog); const shapeOnly = { substates: [{ name: "" }, { name: "" }] };
  expect(await saveDraftSubstates({ token: "x", draftId, ifMatch: "opaque", body: shapeOnly })).toMatchObject({ ok: true });
  expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(shapeOnly)); expect(new Headers(fetch.mock.calls[0][1].headers).get("if-match")).toBe("opaque");
});
