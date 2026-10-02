import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every production source file under `src/` (test files excluded). */
function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return productionFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(entry) && !/\.test\./.test(entry)
      ? [full]
      : [];
  });
}

const SRC = join(process.cwd(), "src");
const rel = (file: string) => file.slice(SRC.length + 1);
const source = (file: string) => readFileSync(file, "utf8");
const files = productionFiles(SRC);

describe("single application-facing request path", () => {
  it("calls fetch only inside the server-only transport", () => {
    const fetchCallers = files.filter((file) => /\bfetch\(/.test(source(file)));
    expect(fetchCallers.map(rel)).toEqual(["lib/api/requestJson.ts"]);
  });

  it("reaches the transport only through the guarded API functions", () => {
    const importers = files.filter((file) =>
      /lib\/api\/server"/.test(source(file)),
    );
    expect(importers.map(rel).sort()).toEqual([
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/create/createJob.ts",
    ]);
    // The transport module is imported only by guarded API functions and the guarded façade.
    const transportImporters = files.filter(
      (file) =>
        /from "[^"]*lib\/api\/(?:server|requestJson)"/.test(source(file)) ||
        /from "\.\/requestJson"/.test(source(file)),
    );
    expect(transportImporters.map(rel).sort()).toEqual([
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/create/createJob.ts",
      "lib/api/server.ts",
    ]);
  });

  it("defines no Next route-handler proxy and no client store", () => {
    expect(files.some((file) => file.endsWith("route.ts"))).toBe(false);
    for (const file of files)
      expect(source(file).toLowerCase()).not.toContain("zustand");
  });
});
