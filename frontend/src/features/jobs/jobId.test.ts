import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// Substitutes the guarded `lib/api/server` module for Vitest only: "server-only"
// cannot execute under jsdom, so the marker is not executed here; production
// import correctness is established by the source-inspection test below.
vi.mock("../../lib/api/server", async () => {
  const transport = await import("../../lib/api/requestJson");
  return { requestJson: transport.requestJson };
});

vi.mock("../../lib/env/server", () => ({
  serverEnv: {
    apiBaseUrl: "http://127.0.0.1:8080",
    siteUrl: "http://127.0.0.1:3000",
    apiTimeoutMs: 8000,
  },
}));

import { getJob, getJobQueryOptions } from "./api/getJob";
import { isValidJobId } from "./jobId";
import { jobItemSchema } from "./schemas";

const UUID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";

const validDetail = {
  id: UUID,
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};
const ok = (status: number, body?: unknown) => ({
  ok: status < 300,
  status,
  json: async () => {
    if (body !== undefined) return body;
    throw new SyntaxError("Unexpected token 'N', is not valid JSON");
  },
});

const MALFORMED = [
  "",
  "123",
  "not-a-uuid",
  UUID.replaceAll("-", ""),
  ` ${UUID}`,
  "../../../etc/passwd",
];

afterEach(() => vi.unstubAllGlobals());

describe("detail UUID prevalidation", () => {
  it("accepts canonical UUIDs and rejects malformed identifiers locally", () => {
    expect(isValidJobId(UUID)).toBe(true);
    expect(isValidJobId("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    for (const bad of MALFORMED) expect(isValidJobId(bad)).toBe(false);
  });

  it("short-circuits malformed identifiers before any transport access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const bad of MALFORMED) {
      await expect(getJob(bad)).resolves.toMatchObject({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("server-only transport boundary", () => {
  it("imports the transport only through the guarded server-only façade", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/jobs/api/getJob.ts"),
      "utf8",
    );
    expect(source).toMatch(/lib\/api\/server"/);
    expect(source).not.toMatch(/lib\/api\/requestJson/);
  });
});

describe("detail query function failure classification", () => {
  it("maps a backend 404 for a valid UUID to exactly not_found and decodes valid payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(404)));
    await expect(getJob(UUID)).resolves.toEqual({
      ok: false,
      error: { kind: "not_found", retryable: false, status: 404 },
    });
    const fetchMock = vi.fn().mockResolvedValue(ok(200, validDetail));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getJob(UUID)).resolves.toEqual({
      ok: true,
      data: jobItemSchema.parse(validDetail),
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe(`http://127.0.0.1:8080/jobs/${UUID}`);
  });
});

describe("detail queryOptions", () => {
  it("builds a serializable array query key containing the exact jobId", () => {
    const { queryKey } = getJobQueryOptions(UUID);
    expect(Array.isArray(queryKey)).toBe(true);
    expect(JSON.parse(JSON.stringify(queryKey))).toEqual(queryKey);
    expect(queryKey).toContain(UUID);
  });

  it("short-circuits malformed identifiers through fetchQuery without any transport access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();
    for (const bad of MALFORMED) {
      await expect(
        queryClient.fetchQuery(getJobQueryOptions(bad)),
      ).resolves.toMatchObject({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
