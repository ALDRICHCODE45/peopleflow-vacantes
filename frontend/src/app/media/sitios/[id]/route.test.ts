// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/media/sitios/[id]/route";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 30 } }));
const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94";
const call = (value = id) => GET(new Request("http://localhost/media/sitios/" + value, { headers: { cookie: "session=private", authorization: "Bearer private" } }), { params: Promise.resolve({ id: value }) });
afterEach(() => vi.unstubAllGlobals());
it("invalid UUID gives 404 without fetching", async () => {
  vi.stubGlobal("fetch", vi.fn()); expect((await call("nope")).status).toBe(404); expect(fetch).not.toHaveBeenCalled();
});
it.each(["image/jpeg", "image/png", "image/webp"])("streams %s and only safe response headers without cookie/auth", async type => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image bytes", { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "set-cookie": "secret=value" } })));
  const response = await call(); expect(response.status).toBe(200); expect(await response.text()).toBe("image bytes");
  expect(response.headers.get("content-type")).toBe(type); expect(response.headers.get("cache-control")).toContain("immutable"); expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.has("set-cookie")).toBe(false);
  const outbound = vi.mocked(fetch).mock.calls[0][0] as Request;
  expect(outbound.url).toBe(`http://localhost:8080/v2/company-sites/media/${id}`);
  expect(outbound.redirect).toBe("error"); expect(outbound.credentials).toBe("omit"); expect(outbound.signal).toBeInstanceOf(AbortSignal);
  expect(outbound.headers.has("cookie")).toBe(false); expect(outbound.headers.has("authorization")).toBe(false);
});
it.each(["text/html", "image/svg+xml", "application/octet-stream", ""])("rejects content type %s", async type => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unsafe", { headers: { "content-type": type } })));
  expect((await call()).status).toBe(502);
});
it.each([404, 403, 500, 302, 204])("handles upstream status %s without leaking its body", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : "private upstream error", { status })));
  const response = await call(); expect(response.status).toBe(status === 404 ? 404 : 502); expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(await response.text()).not.toContain("private upstream");
});
it("preserves upstream cache policy for a 404 without forwarding its JSON body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"missing"}', { status: 404, headers: { "cache-control": "public, max-age=60", "content-type": "application/json" } })));
  const response = await call();
  expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("public, max-age=60"); expect(await response.text()).toBe("");
});
it("handles network errors and an upstream timeout", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline"))); expect((await call()).status).toBe(502);
  vi.stubGlobal("fetch", vi.fn((request: Request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))))); expect((await call()).status).toBe(502);
});
