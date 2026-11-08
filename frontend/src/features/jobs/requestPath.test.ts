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
      "app/media/sitios/[id]/route.ts",
      "components/auth/CandidateAuthControls.tsx",
      "features/audit-log/client.ts",
      "features/audit-log/export-button.tsx",
      // Bodyless PUT 204 (mark a company message read), server-only to the configured origin.
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/file-client.ts",
      "features/candidate-cvs/upload.ts",
      "features/company-site/api/file-client.ts",
      "features/company-site/upload.ts",
      "features/employer-team/client.ts",
      "features/geo/use-geo-catalog.ts",
      "features/languages/use-language-catalog.ts",
      "features/manual-intake/file-client.ts",
      "features/manual-intake/upload.ts",
      "features/org-candidates/cv/cv-client.ts",
      "features/org-candidates/cv/upload.ts",
      "features/org-candidates/detail/file-client.ts",
      "features/pipeline-movement/file-client.ts",
      // Candidate consent/answer 204 and Retry-After: validated segments, configured-origin guard.
      "features/psychometrics/client.ts",
      // Bodyless DELETE 204 and bounded list bodies (saved vacancies), server-only to the configured origin.
      "features/saved-vacancies/client.ts",
      "features/stakeholder-invitations/client.ts",
      // Bodyless DELETE 204 (clear a checklist mark), same-origin guarded like employer-team.
      "features/vacancy-checklist/client.ts",
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

  it("lets «Crear cuenta» POST only to the fixed same-origin NextAuth sign-in route", () => {
    const controls = source(join(SRC, "components/auth/CandidateAuthControls.tsx"));
    expect(controls.match(/\bfetch\([^,)]*/g)).toEqual(['fetch("/api/auth/signin/cognito"']);
    expect(controls).not.toMatch(/https?:\/\/|lib\/api\/|authorization|cookie:/i);
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

  it.each(["features/employer-team/client.ts", "features/org-candidates/cv/cv-client.ts", "features/org-candidates/detail/file-client.ts", "features/psychometrics/client.ts", "features/saved-vacancies/client.ts", "features/audit-log/client.ts", "features/stakeholder-invitations/client.ts"])("keeps the %s fetch adapter server-only with the same fetch guards", file => {
    const adapter = source(join(SRC, file));
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

  it("keeps the audit export download fixed to its same-origin route without credentials in the browser", () => {
    const button = source(join(SRC, "features/audit-log/export-button.tsx"));
    expect(button).toContain('credentials: "same-origin"');
    expect(button).not.toMatch(/https?:\/\/|lib\/auth|authorization|cookie:/);
    expect(source(join(SRC, "app/api/company/audit-events/export/route.ts"))).not.toMatch(/\bfetch\(/);
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

  it.each(["features/employer-dashboard/client.ts", "features/org-candidates/contacts/contacts-client.ts", "features/org-candidates/edit/edit-client.ts", "features/org-candidates/history/history-client.ts", "features/org-candidates/summary/summary-client.ts", "features/vacancy-team/api-client.ts", "features/vacancy-assignments/api-client.ts", "features/talent-base-visibility/client.ts", "features/company-metrics/client.ts"])("keeps %s server-only through the shared transport", file => {
    const client = source(join(SRC, file));
    expect(client).toContain('import "server-only"');
    expect(client).toContain('from "@/lib/api/server"');
    expect(client).not.toMatch(/\bfetch\(/);
  });

  it("keeps own assignment history behind the authenticated read boundary", () => {
    const client = source(join(SRC, "features/vacancy-assignments/api-client.ts"));
    expect(client).toContain("/v2/me/vacancy-assignments/history");
    expect(client).toContain("historySchema.parse(value)");
    const actions = source(join(SRC, "features/vacancy-assignments/actions.ts"));
    expect(actions).toContain('"use server"');
    expect(actions).toContain("getActionAccessToken()");
    expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
    expect(source(join(SRC, "features/vacancy-assignments/action-client.ts"))).not.toMatch(/\bfetch\(|lib\/api\/|lib\/auth\//);
  });

  it("keeps member preview and offboard under the authenticated membership boundary", () => {
    const client = source(join(SRC, "features/employer-team/client.ts"));
    expect(client).toContain('`/me/company/members/${id}/${write ? "offboard" : "offboard-preview"}`');
    expect(client).toContain('"idempotency-key": write.key');
    expect(client).toContain("offboardResultSchema.parse(value)");
    const actions = source(join(SRC, "features/employer-team/actions.ts"));
    expect(actions).toContain('"use server"');
    expect(actions).toContain("getActionAccessToken()");
    expect(actions).toContain("export async function previewOffboardAction");
    expect(actions).toContain("export async function offboardMemberAction");
    expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
    const browser = source(join(SRC, "features/employer-team/offboard-action-client.ts"));
    expect(browser).not.toMatch(/\bfetch\(|lib\/api\/|lib\/auth\//);
  });

  it("keeps all six team writes behind the authenticated server action and guarded transport", () => {
    const client = source(join(SRC, "features/vacancy-team/api-client.ts"));
    for (const path of ['"/members"', '`/members/${write.userId}/remove`', '`/members/${write.userId}`', '"/reassign-responsible"']) expect(client).toContain(path);
    for (const header of ['"if-match"', '"idempotency-key"']) expect(client).toContain(header);
    expect(client).toContain('write.kind === "mode" ? "PUT" : write.kind === "deadline" ? "PATCH" : "POST"');
    const actions = source(join(SRC, "features/vacancy-team/actions.ts"));
    expect(actions).toContain('"use server"');
    expect(actions).toContain("getActionAccessToken()");
    expect(actions.match(/export async function (\w+)/g)).toEqual([
      "export async function writeTeamAction", "export async function loadTeamAction", "export async function loadTeamHistoryAction", "export async function loadTeamMembersAction", "export async function loadTeamCalendarAction",
    ]);
    expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
  });

  it("keeps placement credit reads and corrections on the authenticated participation boundary", () => {
    const client = source(join(SRC, "features/pipeline-movement/client.ts"));
    expect(client).toContain('import "server-only"');
    expect(client).toContain('from "@/lib/api/server"');
    expect(client).toContain('`participations/${input.participationId}/placement-credits`');
    expect(client).toContain('/participations/${input.participationId}/placement-credits/${input.creditId}/${input.action}');
    expect(client).toContain('"idempotency-key": input.idempotencyKey');
    expect(client).not.toMatch(/\bfetch\(/);
    const actions = source(join(SRC, "features/pipeline-movement/actions.ts"));
    expect(actions).toContain('"use server"');
    expect(actions).toContain("getActionAccessToken()");
    expect(actions.match(/export async function (\w+)/g)).toEqual([
      "export async function loadBoardAction", "export async function loadParticipationAction", "export async function loadHistoryAction",
      "export async function loadPlacementCreditsAction", "export async function correctPlacementCreditAction", "export async function moveParticipationAction",
      "export async function setParticipationSubstateAction", "export async function discardParticipationAction", "export async function recoverParticipationAction",
    ]);
    expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
  });

  it("keeps corrected CV uploads on the bounded same-origin route and server actions behind the file client", () => {
    const upload = source(join(SRC, "features/org-candidates/cv/upload.ts"));
    expect(upload).toContain("fetch(candidateCvHref(candidate, participationId)");
    expect(upload).toContain('credentials: "same-origin"');
    expect(upload).not.toMatch(/https?:\/\/|lib\/auth|authorization|cookie:/);
    const actions = source(join(SRC, "features/org-candidates/cv/cv-actions.ts"));
    expect(actions).toContain('from "./cv-client"');
    expect(actions).not.toMatch(/\bfetch\(|lib\/api\//);
    const route = source(join(SRC, "app/api/company/candidates/[kind]/[id]/participations/[participationId]/cv/route.ts"));
    expect(route).toContain("readBoundedBody(request.body, CV_ENVELOPE_CAP");
    expect(route).not.toMatch(/\bfetch\(/);
  });

  it("keeps careers-site uploads on a fixed same-origin route and backend calls server-only", () => {
    const upload = source(join(SRC, "features/company-site/upload.ts"));
    expect(upload).toContain('fetch("/api/company/site/media"');
    expect(upload).toContain('credentials: "same-origin"');
    expect(upload).not.toMatch(/https?:\/\/|lib\/auth|authorization|cookie:|credentials: "include"/);
    const adapter = source(join(SRC, "features/company-site/api/file-client.ts"));
    expect(adapter).toContain('import "server-only"');
    expect(adapter).toContain('redirect: "error"');
    expect(adapter).toContain('cache: "no-store"');
    expect(adapter).toContain('"/v2/me/company/site/media"');
    const route = source(join(SRC, "app/api/company/site/media/route.ts"));
    expect(route).toContain("getActionAccessToken()");
    expect(route).toContain("readBoundedBody(request.body, CAP");
    expect(route).not.toMatch(/\bfetch\(/);
  });

  it("keeps the careers-site media proxy anonymous, fixed to the media path and without redirects", () => {
    const route = source(join(SRC, "app/media/sitios/[id]/route.ts"));
    expect(route).toContain('credentials: "omit"');
    expect(route).toContain('redirect: "error"');
    expect(route).toContain("`/v2/company-sites/media/${id}`");
    expect(route).toMatch(/z\.string\(\)\.uuid\(\)\.safeParse\(id\)/);
    expect(route).not.toMatch(/request\.headers|cookies\(|authorization/i);
  });

  it("reaches the transport only through the guarded API functions", () => {
    const importers = files.filter((file) =>
      /lib\/api\/server"/.test(source(file)),
    );
    expect(importers.map(rel).sort()).toEqual([
      "features/audit-log/client.ts",
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/client.ts",
      "features/candidate/profile-client.ts",
      "features/company-metrics/client.ts",
      "features/company-site/api/client.ts",
      "features/company-site/public/read.ts",
      "features/employer-company/api/company-client.ts",
      "features/employer-dashboard/client.ts",
      "features/employer-team/client.ts",
      "features/geo/client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/api/listRelatedJobs.ts",
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
      "features/org-candidates/client.ts",
      "features/org-candidates/contacts/contacts-client.ts",
      "features/org-candidates/detail/detail-client.ts",
      "features/org-candidates/edit/edit-client.ts",
      "features/org-candidates/history/history-client.ts",
      "features/org-candidates/summary/summary-client.ts",
      "features/pipeline-movement/client.ts",
      "features/psychometrics/client.ts",
      "features/stakeholder-invitations/client.ts",
      "features/talent-base-visibility/client.ts",
      "features/vacancy-assignments/api-client.ts",
      "features/vacancy-checklist/client.ts",
      "features/vacancy-lifecycle/client.ts",
      "features/vacancy-team/api-client.ts",
      "lib/auth/backend-check.ts",
    ]);
    // The transport module is imported only by guarded API functions and the guarded façade.
    const transportImporters = files.filter(
      (file) =>
        /from "[^"]*lib\/api\/(?:server|requestJson)"/.test(source(file)) ||
        /from "\.\/requestJson"/.test(source(file)),
    );
    expect(transportImporters.map(rel).sort()).toEqual([
      "features/audit-log/client.ts",
      "features/candidate-applications/client.ts",
      "features/candidate-cvs/client.ts",
      "features/candidate/profile-client.ts",
      "features/company-metrics/client.ts",
      "features/company-site/api/client.ts",
      "features/company-site/public/read.ts",
      "features/employer-company/api/company-client.ts",
      "features/employer-dashboard/client.ts",
      "features/employer-team/client.ts",
      "features/geo/client.ts",
      "features/identity/candidate-account-client.ts",
      "features/identity/me-client.ts",
      "features/jobs/api/getJob.ts",
      "features/jobs/api/listJobs.ts",
      "features/jobs/api/listRelatedJobs.ts",
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
      "features/org-candidates/client.ts",
      "features/org-candidates/contacts/contacts-client.ts",
      "features/org-candidates/detail/detail-client.ts",
      "features/org-candidates/edit/edit-client.ts",
      "features/org-candidates/history/history-client.ts",
      "features/org-candidates/summary/summary-client.ts",
      "features/pipeline-movement/client.ts",
      "features/psychometrics/client.ts",
      "features/stakeholder-invitations/client.ts",
      "features/talent-base-visibility/client.ts",
      "features/vacancy-assignments/api-client.ts",
      "features/vacancy-checklist/client.ts",
      "features/vacancy-lifecycle/client.ts",
      "features/vacancy-team/api-client.ts",
      "lib/api/server.ts",
      "lib/auth/backend-check.ts",
    ]);
  });

  it("allows only identity handlers, the candidate/recruiter CV file boundaries and the public geo catalog, not client stores", () => {
    const handlers = files.filter((file) => file.endsWith("route.ts"));
    expect(handlers.map(rel).sort()).toEqual([
      "app/(public)/evaluacion/[token]/route.ts",
      "app/api/auth/[...nextauth]/route.ts",
      "app/api/auth/backend-check/route.ts",
      "app/api/auth/cognito/logout/route.ts",
      "app/api/auth/local-bootstrap/apply/route.ts",
      "app/api/auth/local-bootstrap/nonce/route.ts",
      "app/api/auth/local-bootstrap/stage/route.ts",
      "app/api/candidate/cvs/[id]/file/route.ts",
      "app/api/candidate/cvs/route.ts",
      "app/api/catalogs/languages/route.ts",
      "app/api/company/audit-events/export/route.ts",
      "app/api/company/candidates/[kind]/[id]/participations/[participationId]/cv/original/route.ts",
      "app/api/company/candidates/[kind]/[id]/participations/[participationId]/cv/route.ts",
      "app/api/company/manual-candidates/[vacancyId]/route.ts",
      "app/api/company/site/media/route.ts",
      "app/api/company/vacancies/[vacancyId]/participations/[participationId]/cv/original/route.ts",
      "app/api/company/vacancies/[vacancyId]/participations/[participationId]/cv/route.ts",
      "app/api/geo/countries/mx/postal-codes/[cp]/route.ts",
      "app/api/geo/countries/mx/states/[state]/municipalities/route.ts",
      "app/api/geo/countries/mx/states/route.ts",
      "app/api/geo/countries/route.ts",
      "app/media/sitios/[id]/route.ts",
    ]);
    for (const handler of handlers) {
      expect(source(handler)).not.toMatch(/lib\/api\/(?:server|requestJson)/);
    }
    for (const file of files)
      expect(source(file).toLowerCase()).not.toContain("zustand");
  });
});
