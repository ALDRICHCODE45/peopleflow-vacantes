import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../lib/api/server", async () => ({ requestJson: (await import("../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", apiTimeoutMs: 8000, sampleJobs: false } }));
import { listJobs } from "./listJobs";
afterEach(() => vi.unstubAllGlobals());
it("forwards H5 dimensions to v2 and preserves invalid_filter", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "invalid_filter", error: "invalid filter" }), { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  expect(await listJobs({ language: ["en", "nah"], seniority: ["junior", "semi_senior"], years_of_experience: "1.5", education_level: "bachelor" })).toMatchObject({ ok: false, envelope: { code: "invalid_filter" } });
  const url = new URL(fetch.mock.calls[0][0]);
  expect(url.pathname).toBe("/v2/jobs");
  expect(url.searchParams.getAll("language")).toEqual(["en", "nah"]);
  expect(url.searchParams.getAll("seniority")).toEqual(["junior", "semi_senior"]);
  expect(url.searchParams.get("years_of_experience")).toBe("1.5");
  expect(url.searchParams.get("education_level")).toBe("bachelor");
});
