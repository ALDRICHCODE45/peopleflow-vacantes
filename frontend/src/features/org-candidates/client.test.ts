import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { listCandidates } from "./client";
import { page } from "./list/test-fixtures";
afterEach(() => vi.unstubAllGlobals());
it("authenticates an absolute v2 no-store GET and encodes repeated filters", async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page))); vi.stubGlobal("fetch", fetch);
 expect(await listCandidates({ token: " token ", filters: { q: "Mariana", language: ["en", "es"], language_min_level: "C1" }, cursor: "a+/=" })).toEqual({ ok: true, data: page });
 const [url, init] = fetch.mock.calls[0]; const parsed = new URL(url);
 expect(parsed.pathname).toBe("/v2/me/company/candidates"); expect(parsed.searchParams.getAll("language")).toEqual(["en", "es"]);
 expect(parsed.searchParams.get("cursor")).toBe("a+/="); expect(parsed.searchParams.get("limit")).toBe("20");
 expect(init).toMatchObject({ cache: "no-store", redirect: "error" }); expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
});
it("guards missing token and rejects response drift", async () => {
 const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...page, extra: true }))); vi.stubGlobal("fetch", fetch);
 expect(await listCandidates({ token: " " })).toMatchObject({ ok: false }); expect(fetch).not.toHaveBeenCalled();
 expect(await listCandidates({ token: "x" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it("decodes the L7 fields array", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unsafe", code: "invalid_filter", fields: [{ field: "vacancy", code: "not_found" }] }), { status: 400 })));
 expect(await listCandidates({ token: "x" })).toMatchObject({ ok: false, envelope: { code: "invalid_filter", fields: [{ field: "vacancy", code: "not_found" }] } });
});
