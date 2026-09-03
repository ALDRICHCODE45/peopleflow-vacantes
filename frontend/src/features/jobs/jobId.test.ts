import { afterEach, describe, expect, it, vi } from "vitest";
import { getJob } from "./api/getJob";
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
