import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../lib/api/server", async () => ({ requestJson: (await import("../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", apiTimeoutMs: 8000, sampleJobs: false } }));
import { listJobs, listJobsQueryOptions } from "./listJobs";
afterEach(() => vi.unstubAllGlobals());
it("sends repeated dimensions exactly once per selected value", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], next_cursor: null })));
  vi.stubGlobal("fetch", fetch);
  await listJobs({ state: ["09", "14", "09"], municipality: ["09002", "14039"], work_mode: ["remote", "hybrid"], applicant_country: "MX" });
  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v2/jobs?state=09&state=14&municipality=09002&municipality=14039&work_mode=remote&work_mode=hybrid&applicant_country=MX");
});
it.each(["invalid_filter", "invalid_request"])("captures %s without retry", async code => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error: "private text" }), { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  expect(await listJobs({ cursor: "old" })).toMatchObject({ ok: false, envelope: { code } });
  expect(listJobsQueryOptions({}).retry).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});
