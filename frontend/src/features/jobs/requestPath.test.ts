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
      "features/geo/use-geo-catalog.ts",
      "features/languages/use-language-catalog.ts",
      "features/manual-intake/file-client.ts",
      "features/manual-intake/upload.ts",
      "features/pipeline-movement/file-client.ts",
      "lib/api/requestJson.ts",
    ]);
  });

  it("lets the browser read the public geo catalog only through its same-origin routes, without credentials", () => {
    const hook = source(join(SRC, "features/geo/use-geo-catalog.ts"));
    expect(hook).toContain("fetch(`/api/geo/${key}`");
    expect(hook).toContain('credentials: "omit"');
    expect(hook).not.toMatch(/https?:\/\/|lib\/api\/|lib\/auth|authorization|cookie:/i);
    const client = source(join(SRC, "features/geo/client.ts"));
    expect(client).toContain('import "server-only"');
  });

  it("lets the browser read languages only through its fixed same-origin route without credentials", () => {
    const hook = source(join(SRC, "features/languages/use-language-catalog.ts"));
    expect(hook).toContain('fetch("/api/catalogs/languages"');
    expect(hook).toContain('credentials: "omit"');
    expect(hook).not.toMatch(/https?:\/\/|lib\/api\/|lib\/auth|authorization|cookie:/i);
    expect(source(join(SRC, "features/languages/client.ts"))).toContain('import "server-only"');
    expect(source(join(SRC, "app/api/catalogs/languages/route.ts"))).not.toMatch(/\bfetch\(|lib\/auth/);
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

  it("keeps the recruiter participation CV adapter server-only with the same fetch guards", () => {
    const adapter = source(join(SRC, "features/pipeline-movement/file-client.ts"));
    expect(adapter).toContain('import "server-only"');
    expect(adapter).toContain('redirect: "error"');
    expect(adapter).toContain('cache: "no-store"');
  });

  it("keeps the manual-intake upload fixed to its same-origin route and the backend call server-only", () => {
    const upload = source(join(SRC, "features/manual-intake/upload.ts"));
    expect(upload).toContain("fetch(`/api/company/manual-candidates/${encodeURIComponent(vacancyId)}`");
    expect(upload).not.toMatch(/https?:\/\/|lib\/auth|authorization|cookie:/);
    const adapter = source(join(SRC, "features/manual-intake/file-client.ts"));
    expect(adapter).toContain('import "server-only"');
    expect(adapter).toContain('redirect: "error"');
    expect(adapter).toContain('cache: "no-store"');
    expect(source(join(SRC, "app/api/company/manual-candidates/[vacancyId]/route.ts"))).not.toMatch(/\bfetch\(/);
  });

  it("reaches the transport only through the guarded API functions", () => {
    const importers = files.filter((file) =>
      /lib\/api\/server"/.test(source(file)),
    );
    expect(importers.map(rel).sort()).toEqual([
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/client.ts",
      "features/candidate/profile-client.ts",
      "features/employer-company/api/company-client.ts",
      "features/geo/client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/drafts/api/client-v2.ts",
      "features/jobs/drafts/api/client.ts",
      "features/jobs/drafts/list/client.ts",
      "features/jobs/drafts/pipeline/client.ts",
      "features/jobs/drafts/pipeline/delivery-client.ts",
      "features/jobs/drafts/pipeline/management-client.ts",
      "features/jobs/drafts/pipeline/publication-client.ts",
      "features/jobs/drafts/pipeline/substates-client.ts",
      "features/jobs/drafts/requesters/client.ts",
      "features/languages/client.ts",
      "features/manual-intake/client.ts",
      "features/pipeline-movement/client.ts",
      "features/vacancy-lifecycle/client.ts",
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
      "features/candidate/profile-client.ts",
      "features/employer-company/api/company-client.ts",
      "features/geo/client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/drafts/api/client-v2.ts",
      "features/jobs/drafts/api/client.ts",
      "features/jobs/drafts/list/client.ts",
      "features/jobs/drafts/pipeline/client.ts",
      "features/jobs/drafts/pipeline/delivery-client.ts",
      "features/jobs/drafts/pipeline/management-client.ts",
      "features/jobs/drafts/pipeline/publication-client.ts",
      "features/jobs/drafts/pipeline/substates-client.ts",
      "features/jobs/drafts/requesters/client.ts",
      "features/languages/client.ts",
      "features/manual-intake/client.ts",
      "features/pipeline-movement/client.ts",
      "features/vacancy-lifecycle/client.ts",
      "lib/api/server.ts",
      "lib/auth/backend-check.ts",
    ]);
  });

  it("allows only identity handlers, the candidate/recruiter CV file boundaries and the public geo catalog, not client stores", () => {
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
      "app/api/catalogs/languages/route.ts",
      "app/api/company/manual-candidates/[vacancyId]/route.ts",
      "app/api/company/vacancies/[vacancyId]/participations/[participationId]/cv/route.ts",
      "app/api/geo/countries/mx/postal-codes/[cp]/route.ts",
      "app/api/geo/countries/mx/states/[state]/municipalities/route.ts",
      "app/api/geo/countries/mx/states/route.ts",
      "app/api/geo/countries/route.ts",
    ]);
    for (const handler of handlers) {
      expect(source(handler)).not.toMatch(/lib\/api\/(?:server|requestJson)/);
    }
    for (const file of files)
      expect(source(file).toLowerCase()).not.toContain("zustand");
  });
});
