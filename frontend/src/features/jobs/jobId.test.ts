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

import { getJob, getJobQueryOptions } from "./api/getJob";
import { isValidJobId } from "./jobId";

const UUID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
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
