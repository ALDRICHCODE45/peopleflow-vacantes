import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getMyCompany } from "@/features/employer-company/api/company-client";
import { getSite } from "@/features/company-site/api/client";
import * as siteClient from "@/features/company-site/api/client";
import { loadPreviewData } from "@/features/company-site/public/preview-data";
import { defaultSiteDraft } from "@/features/company-site/defaults";
import { loadCareersEditor } from "./actions";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/employer-company/api/company-client", () => ({ getMyCompany: vi.fn() }));
vi.mock("@/features/company-site/public/preview-data", () => ({ loadPreviewData: vi.fn() }));
const site = { draft: defaultSiteDraft(), draft_version: 7, published: null, has_unpublished_changes: true, media: [], updated_at: "2026-10-27T00:00:00Z" };
const company = { id: "real-company", name: "Empresa real", rfc: "private-rfc", industry_id: "industry", status: "active" as const, location: null, updated_at: site.updated_at };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  vi.spyOn(siteClient, "getSite").mockResolvedValue({ kind: "success", data: site, etag: '"7"' });
  vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: company.id, role: "owner", company } });
  vi.mocked(loadPreviewData).mockImplementation(async identity => ({ company: identity, jobs: [], jobsAvailable: true, officeLabels: new Map() }));
});
it.each(["owner", "recruiter"] as const)("loads the session-scoped draft and preview for %s", async role => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: company.id, role, company } });
  const result = await loadCareersEditor();
  expect(result).toMatchObject({ ok: true, site, role, preview: { company: { id: company.id, name: company.name } } });
  expect(getSite).toHaveBeenCalledWith("private-token");
  expect(getMyCompany).toHaveBeenCalledWith({ token: "private-token" });
  expect(loadPreviewData).toHaveBeenCalledWith(expect.objectContaining({ id: company.id }), site.draft.blocks);
  expect(JSON.stringify(result)).not.toMatch(/private-token|private-rfc|industry/);
});
it.each(["forbidden", "company_inactive"] as const)("preserves the draft %s gate", async code => {
  vi.mocked(getSite).mockResolvedValue({ kind: "error", code });
  expect(await loadCareersEditor()).toEqual({ ok: false, code });
  expect(loadPreviewData).not.toHaveBeenCalled();
});
it.each([null, "", " \t\n"])("fails closed with an empty session (%j)", async token => {
  vi.mocked(getActionAccessToken).mockResolvedValue(token);
  expect(await loadCareersEditor()).toEqual({ ok: false, code: "unauthenticated" });
  expect(getSite).not.toHaveBeenCalled();
  expect(getMyCompany).not.toHaveBeenCalled();
});
it.each(["uncertain", "unrecognized"] as const)("sanitizes draft %s failures", async kind => {
  vi.mocked(getSite).mockResolvedValue({ kind });
  expect(await loadCareersEditor()).toEqual({ ok: false, code: "unavailable" });
});
it("sanitizes thrown failures", async () => {
  vi.mocked(loadPreviewData).mockRejectedValue(new Error("private-token"));
  expect(await loadCareersEditor()).toEqual({ ok: false, code: "unavailable" });
});
afterEach(() => vi.unstubAllGlobals());
it.each([
  { error: "private-token", code: "unauthenticated" },
  {},
  "not-json",
  null,
])("maps transport 401 through the real site client (%j)", async body => {
  // Restore the real export: only HTTP is simulated for this regression.
  vi.mocked(getSite).mockRestore();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 401 })));
  const result = await loadCareersEditor();
  expect(result).toEqual({ ok: false, code: "unauthenticated" });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(fetch).toHaveBeenCalledExactlyOnceWith("http://localhost:8080/v2/me/company/site", expect.any(Object));
  expect(getMyCompany).not.toHaveBeenCalled();
});
it.each([
  [403, "forbidden", "forbidden"],
  [403, "company_inactive", "company_inactive"],
  [403, "unknown", "unavailable"],
  [403, undefined, "unavailable"],
  [500, "forbidden", "unavailable"],
] as const)("sanitizes membership status %s code %s", async (status, code, expected) => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, ...(code === undefined ? {} : { envelope: { error: "private-token", code } }) });
  const result = await loadCareersEditor();
  expect(result).toEqual({ ok: false, code: expected });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(loadPreviewData).not.toHaveBeenCalled();
});
it.each(["session", "site", "membership"] as const)("sanitizes exceptions from %s", async source => {
  const failure = new Error("private-token");
  if (source === "session") vi.mocked(getActionAccessToken).mockRejectedValue(failure);
  if (source === "site") vi.mocked(getSite).mockRejectedValue(failure);
  if (source === "membership") vi.mocked(getMyCompany).mockRejectedValue(failure);
  const result = await loadCareersEditor();
  expect(result).toEqual({ ok: false, code: "unavailable" });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(loadPreviewData).not.toHaveBeenCalled();
});
it("ignores hostile invocation arguments and uses only the session company", async () => {
  const invoke = loadCareersEditor as (...args: unknown[]) => ReturnType<typeof loadCareersEditor>;
  const result = await invoke({ companyId: "other", token: "hostile-token", role: "owner" }, "other");
  expect(result).toMatchObject({ ok: true, preview: { company: { id: company.id } } });
  expect(getSite).toHaveBeenCalledExactlyOnceWith("private-token");
  expect(getMyCompany).toHaveBeenCalledExactlyOnceWith({ token: "private-token" });
  expect(loadPreviewData).toHaveBeenCalledWith(expect.objectContaining({ id: company.id }), site.draft.blocks);
  expect(JSON.stringify(result)).not.toMatch(/private-token|hostile-token|other/);
});
it("handles an expired membership session", async () => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: false, error: { kind: "status", status: 401, retryable: false } });
  expect(await loadCareersEditor()).toEqual({ ok: false, code: "unauthenticated" });
});
