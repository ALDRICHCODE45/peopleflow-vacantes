import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({ get serverEnv() { env.reads++; return { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 }; } }));
import { createRequester, listRequesters } from "./client";
const entry = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", kind: "client", name: "Acme" };
function mockResponse(body: unknown, status = 200) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => { vi.unstubAllGlobals(); env.reads = 0; });
it("lists with encoded prefix and opaque cursor and Bearer only", async () => {
 const fetch = mockResponse({ items: [entry], next_cursor: "abc-_12" });
 expect(await listRequesters({ token: " secret ", kind: "client", q: "A & B", cursor: "abc-_12", limit: 50 })).toEqual({ ok: true, data: { items: [entry], next_cursor: "abc-_12" } });
 expect(fetch.mock.calls[0][0]).toBe("http://localhost:8080/me/company/requesters?kind=client&q=A+%26+B&limit=50&cursor=abc-_12");
 expect(fetch.mock.calls[0][1].redirect).toBe("error"); expect(new Headers(fetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer secret"); expect(new Headers(fetch.mock.calls[0][1].headers).has("cookie")).toBe(false);
});
it("creates with exactly kind and name", async () => {
 const fetch = mockResponse(entry, 201);
 expect(await createRequester({ token: "secret", kind: "client", name: "Acme" })).toEqual({ ok: true, data: entry });
 expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ kind: "client", name: "Acme" }));
});
it.each([{ token: "", kind: "client" }, { token: "x", kind: "bad" }, { token: "x", kind: "client", q: "😀".repeat(161) }, { token: "x", kind: "client", cursor: "=" }, { token: "x", kind: "client", cursor: "a".repeat(4097) }, { token: "x", kind: "client", limit: 0 }])("guards list before env/network %j", async (input) => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect((await listRequesters(input as Parameters<typeof listRequesters>[0])).ok).toBe(false); expect(fetch).not.toHaveBeenCalled(); expect(env.reads).toBe(0);
});
it.each([" ", "😀".repeat(161), "bad\u0000name"])("guards name %j", async name => {
 const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
 expect((await createRequester({ token: "x", kind: "client", name })).ok).toBe(false); expect(env.reads).toBe(0); expect(fetch).not.toHaveBeenCalled();
});
it.each([{ items: [ { ...entry, id: entry.id.toUpperCase() } ], next_cursor: null }, { items: [entry], next_cursor: "=" }, { items: [entry], next_cursor: null, extra: true }])("rejects malformed success %j", async body => {
 mockResponse(body); expect(await listRequesters({ token: "x", kind: "client" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([
 [400,"invalid_request"], [400,"validation_error"], [401,"unauthenticated"],
 [403,"forbidden"], [403,"company_inactive"], [409,"company_not_active"],
 [413,"payload_too_large"], [500,"internal_error"],
] as const)("preserves %s %s safely without retrying", async (status,code) => {
 const fetch = mockResponse({error:"Rechazado",code},status);
 expect(await createRequester({token:"x",kind:"client",name:"Acme"})).toMatchObject({ok:false,error:{kind:"status",status,retryable:false},envelope:{error:"Rechazado",code}});
 expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
 {error:"Error",code:"internal_error",data:{existing:entry}},
 {error:"Error",code:"requester_already_exists",data:{existing:{...entry,kind:"internal_area"}}},
 {error:"Error",code:"requester_already_exists",data:{existing:{...entry,extra:true}}},
])("does not expose malformed or cross-kind conflict data",async envelope=>{
 mockResponse(envelope,409);
 const result=await createRequester({token:"x",kind:"client",name:"Acme"});
 expect(result.ok).toBe(false);
 expect(result).not.toHaveProperty("envelope");
});
it("accepts boundary codepoint counts and opaque cursor without rewriting",async()=>{
 const cursor="_-a".repeat(1365)+"z";
 const fetch=mockResponse({items:[],next_cursor:null});
 expect((await listRequesters({token:"x",kind:"internal_area",q:"😀".repeat(160),cursor,limit:1})).ok).toBe(true);
 const url=new URL(fetch.mock.calls[0][0]);expect(url.searchParams.get("cursor")).toBe(cursor);expect(url.searchParams.getAll("kind")).toEqual(["internal_area"]);
 mockResponse({...entry,name:"😀".repeat(160)},201);
 expect((await createRequester({token:"x",kind:"client",name:"😀".repeat(160)})).ok).toBe(true);
});
it("decodes conflict existing only for its code", async () => {
 mockResponse({ error: "Existe", code: "requester_already_exists", data: { existing: entry } }, 409);
 expect(await createRequester({ token: "x", kind: "client", name: "Acme" })).toMatchObject({ ok: false, envelope: { data: { existing: entry } } });
});
