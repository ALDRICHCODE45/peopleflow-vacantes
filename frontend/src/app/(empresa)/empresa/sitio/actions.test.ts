import { beforeEach, expect, it, vi } from "vitest";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getMyCompany } from "@/features/employer-company/api/company-client";
import { getSite } from "@/features/company-site/api/client";
import { loadPreviewData } from "@/features/company-site/public/preview-data";
import { defaultSiteDraft } from "@/features/company-site/defaults";
import { loadCareersEditor } from "./actions";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/employer-company/api/company-client", () => ({ getMyCompany: vi.fn() }));
vi.mock("@/features/company-site/api/client", () => ({ getSite: vi.fn() }));
vi.mock("@/features/company-site/public/preview-data", () => ({ loadPreviewData: vi.fn() }));
const site = { draft: defaultSiteDraft(), draft_version: 7, published: null, has_unpublished_changes: true, media: [], updated_at: "2026-10-27T00:00:00Z" };
const company = { id: "real-company", name: "Empresa real", rfc: "private-rfc", industry_id: "industry", status: "active" as const, location: null, updated_at: site.updated_at };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  vi.mocked(getSite).mockResolvedValue({ kind: "success", data: site, etag: '"7"' });
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
it("fails closed without a session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
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
it("handles an expired membership session", async () => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: false, error: { kind: "status", status: 401, retryable: false } });
  expect(await loadCareersEditor()).toEqual({ ok: false, code: "unauthenticated" });
});
