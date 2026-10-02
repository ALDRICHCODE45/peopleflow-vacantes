import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// Substitutes the guarded `lib/api/server` module for Vitest only: "server-only"
// cannot execute under jsdom, so the marker is not executed here; production
// import correctness is established by the source-inspection test below.
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
import { listSampleJobs } from "../sample-jobs";
import { jobsListSchema } from "../schemas";
import type { JobsList } from "../types";
import type { JobsQuery } from "../url";
import { listJobs, listJobsQueryOptions } from "./listJobs";

const validListPayload = {
  items: [
    {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
      title: "Ingeniera Frontend",
      description: "Construye la experiencia de vacantes.",
      work_mode: "remote",
      employment_type: "full_time",
      seniority: "senior",
      salary_currency: "MXN",
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
    },
  ],
  next_cursor: "siguiente-lote",
};
const fullQuery: JobsQuery = {
  q: "react",
  seniority: "senior",
  work_mode: "remote",
  employment_type: "full_time",
  location: "Monterrey",
  currency: "MXN",
  cursor: "cur-1",
};
const CANONICAL_ORDER = [
  "q",
  "seniority",
  "work_mode",
  "employment_type",
  "location",
  "currency",
  "cursor",
];

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

const env = serverEnv as { sampleJobs: boolean };

afterEach(() => {
  env.sampleJobs = false;
  vi.unstubAllGlobals();
});

describe("list jobs query key", () => {
  it("is hierarchical, JSON-serializable, insertion-order-independent, and canonicalized", () => {
    const shuffled: JobsQuery = {
      cursor: "cur-1",
      currency: "MXN",
      seniority: "senior",
      q: "react",
      work_mode: "remote",
      location: "Monterrey",
      employment_type: "full_time",
    };
    const key = listJobsQueryOptions(shuffled).queryKey;
    expect(key).toEqual(listJobsQueryOptions(fullQuery).queryKey);
    expect(key).toEqual([
      "jobs",
      "list",
      {
        q: "react",
        seniority: "senior",
        work_mode: "remote",
        employment_type: "full_time",
        location: "Monterrey",
        currency: "MXN",
        cursor: "cur-1",
      },
    ]);
    expect(Object.keys(key[2] as object)).toEqual(CANONICAL_ORDER);
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);
    expect(listJobsQueryOptions({}).queryKey).toEqual(["jobs", "list", {}]);
    // Non-canonical input values never reach the key state uncanonicalized.
    expect(
      listJobsQueryOptions({
        q: " react ",
        seniority: "staff",
        currency: "EUR",
        cursor: "",
      }).queryKey,
    ).toEqual(listJobsQueryOptions({ q: "react" }).queryKey);
  });

  it("uses the construction-time snapshot: later input mutation cannot change key or request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, validListPayload));
    vi.stubGlobal("fetch", fetchMock);
    const input: JobsQuery = { q: "react" };
    const options = listJobsQueryOptions(input);
    input.q = "mutada";
    input.cursor = "cursor-2";
    expect(options.queryKey).toEqual(["jobs", "list", { q: "react" }]);
    await expect(
      (options.queryFn as () => Promise<RequestJsonResult<JobsList>>)(),
    ).resolves.toEqual({
      ok: true,
      data: jobsListSchema.parse(validListPayload),
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe("http://127.0.0.1:8080/jobs?q=react");
  });
});

describe("list jobs query function", () => {
  it("forwards only canonical values to root-level GET /jobs in canonical order and decodes the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, validListPayload));
    vi.stubGlobal("fetch", fetchMock);
    const shuffled: JobsQuery = {
      employment_type: "full_time",
      cursor: "cur-1",
      q: "react",
      currency: "MXN",
      work_mode: "remote",
      seniority: "senior",
      location: "Monterrey",
    };
    await expect(listJobs(shuffled)).resolves.toEqual({
      ok: true,
      data: jobsListSchema.parse(validListPayload),
    });
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      "http://127.0.0.1:8080/jobs?q=react&seniority=senior&work_mode=remote&employment_type=full_time&location=Monterrey&currency=MXN&cursor=cur-1",
    );
    expect(init.method ?? "GET").toBe("GET"); // effective GET semantics
    expect(init.cache).toBe("no-store");
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect([...headers.keys()].sort()).toEqual(["accept"]);
  });

  it("canonicalizes direct calls: trims q/location, drops invalid enums, currency, and empty cursor, omits absent keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, validListPayload));
    vi.stubGlobal("fetch", fetchMock);
    await listJobs({
      q: "  react  ",
      seniority: "staff",
      currency: "EUR",
      work_mode: "remote",
      location: "   ",
      cursor: "",
    });
    const [canonicalUrl] = fetchMock.mock.calls[0] as [string];
    expect(canonicalUrl).toBe(
      "http://127.0.0.1:8080/jobs?q=react&work_mode=remote",
    );
    // Percent spelling comes from URLSearchParams (space is `+`); the decoded cursor
    // value is preserved byte-for-byte, which is the opacity contract.
    await listJobs({ cursor: "a b&c=d" });
    const [cursorUrl] = fetchMock.mock.calls[1] as [string];
    expect(cursorUrl).toBe("http://127.0.0.1:8080/jobs?cursor=a+b%26c%3Dd");
    await listJobs({ q: "   " });
    const [bareUrl] = fetchMock.mock.calls[2] as [string];
    expect(bareUrl).toBe("http://127.0.0.1:8080/jobs");
  });

  it("classifies list failures without a detail not-found mapping and rejects schema violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(404)));
    await expect(listJobs({})).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 404 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(503)));
    await expect(listJobs({})).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 503 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ok(200, { items: [{ id: "nope" }] })),
    );
    const result = await listJobs({});
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain("nope");
  });

  it("imports the transport only through the guarded server-only façade", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/jobs/api/listJobs.ts"),
      "utf8",
    );
    expect(source).toMatch(/lib\/api\/server"/);
    expect(source).not.toMatch(/lib\/api\/requestJson/);
  });

  it("serves the sample listing without any transport request when the flag is enabled", async () => {
    env.sampleJobs = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listJobs({})).resolves.toEqual({ ok: true, data: listSampleJobs({}) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wires the query options queryFn to the same listJobs behavior", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(200, validListPayload));
    vi.stubGlobal("fetch", fetchMock);
    const options = listJobsQueryOptions({ q: "go" });
    expect(options.queryFn).toBeTypeOf("function");
    await expect(
      (options.queryFn as () => Promise<RequestJsonResult<JobsList>>)(),
    ).resolves.toEqual({
      ok: true,
      data: jobsListSchema.parse(validListPayload),
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe("http://127.0.0.1:8080/jobs?q=go");
  });

  it("returns the validated JobsList contract from the query function", () => {
    expectTypeOf(listJobs({})).toEqualTypeOf<
      Promise<RequestJsonResult<JobsList>>
    >();
  });
});
