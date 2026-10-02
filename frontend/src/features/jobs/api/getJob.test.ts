import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// Substitutes the guarded `lib/api/server` module for Vitest only: "server-only"
// cannot execute under jsdom, so the marker is not executed here.
vi.mock("../../../lib/api/server", async () => {
  const transport = await import("../../../lib/api/requestJson");
  return { requestJson: transport.requestJson };
});

vi.mock("../../../lib/env/server", () => ({
  serverEnv: {
    apiBaseUrl: "http://127.0.0.1:8080",
    siteUrl: "http://127.0.0.1:3000",
    apiTimeoutMs: 8000,
    sampleJobs: false,
  },
}));

import type { RequestJsonResult } from "../../../lib/api/server";
import { serverEnv } from "../../../lib/env/server";
import { SAMPLE_JOBS } from "../sample-jobs";
import { jobItemSchema } from "../schemas";
import type { JobItem } from "../types";
import { getJob, getJobQueryOptions } from "./getJob";

const env = serverEnv as { sampleJobs: boolean };
const sampleJob = SAMPLE_JOBS[0]!;
const unknownSampleId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7fff";

const wireJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

function ok(status: number, body?: unknown) {
  return {
    ok: status < 300,
    status,
    json: async () => {
      if (body !== undefined) return body;
      throw new SyntaxError("Unexpected token 'N', is not valid JSON");
    },
  };
}

beforeEach(() => {
  env.sampleJobs = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("getJob detail read", () => {
  it("rejects malformed identifiers before any environment or transport access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob("no-es-un-uuid")).resolves.toEqual({
      ok: false,
      error: { kind: "not_found", retryable: false, status: 404 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the sample detail without any transport request when the flag is enabled", async () => {
    env.sampleJobs = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob(sampleJob.id)).resolves.toEqual({ ok: true, data: sampleJob });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the canonical unknown-id 404 shape for an unknown sample identifier", async () => {
    env.sampleJobs = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob(unknownSampleId)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found", retryable: false, status: 404 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the real API detail path when the flag is off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, wireJob));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob(wireJob.id)).resolves.toEqual({
      ok: true,
      data: jobItemSchema.parse(wireJob),
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe(`http://127.0.0.1:8080/jobs/${wireJob.id}`);
  });

  it("maps a backend 404 to not-found and other failures to status without a not-found mapping", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob(wireJob.id)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found", retryable: false, status: 404 },
    });
    fetchMock.mockResolvedValue(ok(500));
    await expect(getJob(wireJob.id)).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 500 },
    });
  });

  it("wires the query options queryFn to the same detail read and keeps the contract type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, wireJob));
    vi.stubGlobal("fetch", fetchMock);
    const options = getJobQueryOptions(wireJob.id);
    expect(options.queryKey).toEqual(["jobs", "detail", wireJob.id]);
    await expect(
      (options.queryFn as () => Promise<RequestJsonResult<JobItem>>)(),
    ).resolves.toEqual({ ok: true, data: jobItemSchema.parse(wireJob) });
    expectTypeOf(getJob(wireJob.id)).toEqualTypeOf<Promise<RequestJsonResult<JobItem>>>();
  });
});
