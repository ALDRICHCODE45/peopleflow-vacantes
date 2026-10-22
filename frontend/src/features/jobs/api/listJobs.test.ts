import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
vi.mock("../../../lib/api/server", async () => ({ requestJson: (await import("../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", apiTimeoutMs: 8000, sampleJobs: false } }));
import { serverEnv } from "../../../lib/env/server";
import type { RequestJsonResult } from "../../../lib/api/server";
import { listSampleJobs } from "../sample-jobs";
import type { PublicJobsList } from "../types";
import { legacyDetail, listItem, vacancyDetail } from "./public-fixtures";
import { listJobs, listJobsQueryOptions, type ListJobsError } from "./listJobs";

const env = serverEnv as { sampleJobs: boolean };
const payload = { items: [listItem(legacyDetail), listItem(vacancyDetail)], next_cursor: null };
const response = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
afterEach(() => { env.sampleJobs = false; vi.unstubAllGlobals(); });

describe("v2 list query", () => {
  it("uses canonical, serializable, insertion-independent keys", () => {
    const a = listJobsQueryOptions({ q: " Go ", work_mode: "remote", work_schedule: "full_time" });
    const b = listJobsQueryOptions({ work_schedule: "full_time", work_mode: "remote", q: "Go" });
    expect(a.queryKey).toEqual(b.queryKey);
    expect(a.queryKey).toEqual(["jobs", "list", { q: "Go", work_mode: ["remote"], work_schedule: "full_time" }]);
    expect(JSON.parse(JSON.stringify(a.queryKey))).toEqual(a.queryKey);
    expect(listJobsQueryOptions({ work_mode: "bad", contract_type: "bad", professional_area: "bad", cursor: "" }).queryKey).toEqual(["jobs", "list", {}]);
  });
  it("snapshots mutable caller input at options construction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal("fetch", fetchMock);
    const input = { q: "Go" };
    const options = listJobsQueryOptions(input);
    input.q = "changed";
    expect(await (options.queryFn as () => Promise<RequestJsonResult<PublicJobsList>>)()).toEqual({ ok: true, data: payload });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v2/jobs?q=Go");
  });
  it("sends only the canonical URL parameters, each once and in fixed order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listJobs({ cursor: "opaque a+b/c=", professional_area: "technology_systems", contract_type: "indefinite", work_schedule: "full_time", work_mode: "hybrid", state: ["09"], q: " Go " })).toEqual({ ok: true, data: payload });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/v2/jobs?q=Go&state=09&work_mode=hybrid&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems&cursor=opaque+a%2Bb%2Fc%3D");
    expect(init.method ?? "GET").toBe("GET");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect([...new Headers(init.headers).keys()]).toEqual(["accept"]);
  });
  it("drops stale keys and invalid values even on direct calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal("fetch", fetchMock);
    await listJobs({ q: " Go ", location: " ", work_mode: "bad", contract_type: "contract", salary_min: "1e3", language: "EN", employment_type: "full_time", seniority: "mid", currency: "MXN", limit: "1000", cursor: "" } as Parameters<typeof listJobs>[0]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8080/v2/jobs?q=Go");
  });
  it.each([[400, false], [404, false], [503, true]])("preserves status %i without detail not-found mapping", async (status, retryable) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "failure", code: "invalid_request" }, status)));
    expect(await listJobs({})).toEqual({ ok: false, error: { kind: "status", retryable, status }, envelope: { code: "invalid_request" } });
  });
  it("rejects a v1 or malformed successful response without leaking payload text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ items: [{ id: "nope" }] })));
    expect(await listJobs({})).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
  });
  it("serves the schema-validated sample list without transport", async () => {
    env.sampleJobs = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await listJobs({})).toEqual({ ok: true, data: listSampleJobs({}) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the guarded transport and exposes the inferred v2 list type", () => {
    const source = readFileSync(join(process.cwd(), "src/features/jobs/api/listJobs.ts"), "utf8");
    expect(source).toMatch(/lib\/api\/server"/);
    expect(source).not.toMatch(/lib\/api\/requestJson/);
    expectTypeOf(listJobs({})).toEqualTypeOf<Promise<RequestJsonResult<PublicJobsList, ListJobsError>>>();
  });
});
