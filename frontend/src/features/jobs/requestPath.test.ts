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
  it("calls fetch only inside guarded transports and fixed same-origin upload/bootstrap adapters", () => {
    const fetchCallers = files.filter((file) => /\bfetch\(/.test(source(file)));
    expect(fetchCallers.map(rel).sort()).toEqual([
      "app/(auth)/empresa/bootstrap-local/bootstrap-local-panel.tsx",
      "features/candidate-cvs/file-client.ts",
      "features/candidate-cvs/upload.ts",
      "lib/api/requestJson.ts",
    ]);
  });

  it("lets the temporary bootstrap panel fetch only its same-origin identity routes", () => {
    const panel = source(join(SRC, "app/(auth)/empresa/bootstrap-local/bootstrap-local-panel.tsx"));
    expect(panel).not.toMatch(/https?:\/\//);
    expect(panel).not.toMatch(/lib\/api\//);
    const endpoints = panel.match(/"\/api\/[^"]*"/g) ?? [];
    expect(endpoints.sort()).toEqual([
      '"/api/auth/local-bootstrap/apply"',
      '"/api/auth/local-bootstrap/nonce"',
      '"/api/auth/local-bootstrap/stage"',
    ]);
  });

  it("keeps CV browser uploads fixed to one same-origin route and the file adapter server-only", () => {
    const upload = source(join(SRC, "features/candidate-cvs/upload.ts"));
    expect(upload).toContain('fetch("/api/candidate/cvs"');
    expect(upload).not.toMatch(/https?:\/\/|lib\/auth|authorization|cookie:/);
    const adapter = source(join(SRC, "features/candidate-cvs/file-client.ts"));
    expect(adapter).toContain('import "server-only"');
    expect(adapter).toContain('redirect: "error"');
    expect(adapter).toContain('cache: "no-store"');
  });

  it("reaches the transport only through the guarded API functions", () => {
    const importers = files.filter((file) =>
      /lib\/api\/server"/.test(source(file)),
    );
    expect(importers.map(rel).sort()).toEqual([
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/client.ts",
      "features/employer-company/api/company-client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/create/createJob.ts",
      "features/jobs/drafts/api/client-v2.ts",
      "features/jobs/drafts/api/client.ts",
      "features/jobs/drafts/list/client.ts",
      "features/jobs/drafts/pipeline/client.ts",
      "features/jobs/drafts/pipeline/delivery-client.ts",
      "features/jobs/drafts/pipeline/management-client.ts",
      "features/jobs/drafts/pipeline/publication-client.ts",
      "features/jobs/drafts/pipeline/substates-client.ts",
      "features/jobs/drafts/requesters/client.ts",
      "lib/auth/backend-check.ts",
    ]);
    // The transport module is imported only by guarded API functions and the guarded façade.
    const transportImporters = files.filter(
      (file) =>
        /from "[^"]*lib\/api\/(?:server|requestJson)"/.test(source(file)) ||
        /from "\.\/requestJson"/.test(source(file)),
    );
    expect(transportImporters.map(rel).sort()).toEqual([
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/client.ts",
      "features/employer-company/api/company-client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/create/createJob.ts",
      "features/jobs/drafts/api/client-v2.ts",
      "features/jobs/drafts/api/client.ts",
      "features/jobs/drafts/list/client.ts",
      "features/jobs/drafts/pipeline/client.ts",
      "features/jobs/drafts/pipeline/delivery-client.ts",
      "features/jobs/drafts/pipeline/management-client.ts",
      "features/jobs/drafts/pipeline/publication-client.ts",
      "features/jobs/drafts/pipeline/substates-client.ts",
      "features/jobs/drafts/requesters/client.ts",
      "lib/api/server.ts",
      "lib/auth/backend-check.ts",
    ]);
  });

  it("allows only identity handlers and the candidate file upload/download boundary, not client stores", () => {
    const handlers = files.filter((file) => file.endsWith("route.ts"));
    expect(handlers.map(rel).sort()).toEqual([
      "app/api/auth/[...nextauth]/route.ts",
      "app/api/auth/backend-check/route.ts",
      "app/api/auth/cognito/logout/route.ts",
      "app/api/auth/local-bootstrap/apply/route.ts",
      "app/api/auth/local-bootstrap/nonce/route.ts",
      "app/api/auth/local-bootstrap/stage/route.ts",
      "app/api/candidate/cvs/[id]/file/route.ts",
      "app/api/candidate/cvs/route.ts",
    ]);
    for (const handler of handlers) {
      expect(source(handler)).not.toMatch(/lib\/api\/(?:server|requestJson)/);
    }
    for (const file of files)
      expect(source(file).toLowerCase()).not.toContain("zustand");
  });
});
