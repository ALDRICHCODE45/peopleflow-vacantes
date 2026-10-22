import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
import { getLanguages } from "./client";
import { GET } from "@/app/api/catalogs/languages/route";
afterEach(() => vi.unstubAllGlobals());
it("uses the guarded anonymous GET and caches only recognized route responses", async () => {
  const body = { items: [{ code: "local:INALI", name: "Mixteco" }] };
  const fetch = vi.fn(() => Promise.resolve(Response.json(body))); vi.stubGlobal("fetch", fetch);
  const response = await GET(new Request("https://app.example.test/api/catalogs/languages"));
  expect(await response.json()).toEqual(body);
  expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
  expect(fetch).toHaveBeenCalledWith("https://api.example.test/v2/catalogs/languages", expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store" }));
  const options = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(options[1].headers).get("authorization")).toBeNull();
  const bad = await GET(new Request("https://app.example.test/api/catalogs/languages?unexpected=1"));
  expect(bad.status).toBe(400); expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects malformed catalog responses and never retries", async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json({ items: [{ id: "es", name: "Español" }] }))); vi.stubGlobal("fetch", fetch);
  expect(await getLanguages()).toEqual({ ok: false, error: "unrecognized_response" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
