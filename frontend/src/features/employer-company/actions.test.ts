import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./api/company-client", () => ({ getMyCompany: vi.fn(), listIndustries: vi.fn(), createCompany: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { createCompany, getMyCompany, listIndustries } from "./api/company-client";
import { createCompanyAction, loadCompanyStateAction } from "./actions";
const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active" as const };
const industries = [{ id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 1 }];
const valid = { name: " Empresa ", rfc: " abc123456789 ", industryId: " i " };
const fail = (status: number, code: string, error = "upstream") => ({ ok: false as const, error: { kind: "status" as const, status, retryable: false as const }, envelope: { error, code } });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); vi.mocked(listIndustries).mockResolvedValue({ ok: true, data: industries }); });
it("fails closed without session for read and create", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadCompanyStateAction()).toEqual({ kind: "unauthenticated" });
  expect(await createCompanyAction(valid)).toEqual({ kind: "unauthenticated" });
  expect(getMyCompany).not.toHaveBeenCalled(); expect(createCompany).not.toHaveBeenCalled(); expect(listIndustries).not.toHaveBeenCalled();
});
it("loads existing company with its Spanish industry and role", async () => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: "c", role: "recruiter", company } });
  expect(await loadCompanyStateAction()).toEqual({ kind: "exists", company, role: "recruiter", industryLabel: "Tecnología" });
  expect(getMyCompany).toHaveBeenCalledWith({ token: "secret" });
});
it("only 404 not_found opens creation with backend industry order", async () => {
  vi.mocked(getMyCompany).mockResolvedValue(fail(404, "not_found"));
  expect(await loadCompanyStateAction()).toEqual({ kind: "none", industries });
  vi.mocked(getMyCompany).mockResolvedValue(fail(404, "other"));
  expect(await loadCompanyStateAction()).toEqual({ kind: "unavailable" });
});
it("keeps existing summary when industry lookup fails", async () => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: "c", role: "owner", company } });
  vi.mocked(listIndustries).mockRejectedValue(new Error("private"));
  expect(await loadCompanyStateAction()).toMatchObject({ kind: "exists", industryLabel: "No disponible" });
});
it("normalizes strings then posts once and returns only the confirmed company", async () => {
  vi.mocked(createCompany).mockResolvedValue({ ok: true, data: company });
  expect(await createCompanyAction(valid)).toEqual({ kind: "created", company });
  expect(createCompany).toHaveBeenCalledExactlyOnceWith({ token: "secret", body: { name: "Empresa", rfc: "ABC123456789", industry_id: "i" } });
});
it.each([
  [{ ...valid, name: "abc" }, "name"], [{ ...valid, rfc: "á".repeat(11) }, "rfc"], [{ ...valid, industryId: " " }, "industryId"],
])("validates locally %j", async (input, field) => {
  expect(await createCompanyAction(input)).toMatchObject({ kind: "invalid", fields: { [field]: expect.any(String) } }); expect(createCompany).not.toHaveBeenCalled();
});
it("counts characters like the Go contract, not bytes or a regex", async () => {
  vi.mocked(createCompany).mockResolvedValue({ ok: true, data: company });
  expect(await createCompanyAction({ name: "éééé", rfc: "Ñ".repeat(12), industryId: "i" })).toMatchObject({ kind: "created" });
  expect(await createCompanyAction({ name: "éé", rfc: "é".repeat(6), industryId: "i" })).toMatchObject({ kind: "invalid", fields: { name: expect.any(String), rfc: expect.any(String) } });
});
it.each([
  [400, "invalid_request", "invalid", "El RFC no es válido."],
  [401, "unauthenticated", "unauthenticated", "secret"],
  [403, "forbidden", "forbidden", "secret"],
  [409, "already_exists", "already_exists", "secret"],
  [409, "industry_unavailable", "industry_unavailable", "secret"],
  [500, "internal_error", "unavailable", "secret"],
  [413, "too_large", "unavailable", "secret"],
])("maps %s %s to %s", async (status, code, kind, message) => {
  vi.mocked(createCompany).mockResolvedValue(fail(status, code, message));
  const result = await createCompanyAction(valid); expect(result).toMatchObject({ kind });
  if (kind === "invalid") expect(result).toMatchObject({ message }); else expect(JSON.stringify(result)).not.toContain("secret");
  expect(createCompany).toHaveBeenCalledTimes(1);
});
it.each(["network", "timeout", "invalid_response"] as const)("sanitizes %s failures without retry", async kind => {
  vi.mocked(createCompany).mockResolvedValue({ ok: false, error: { kind, retryable: false } }); expect(await createCompanyAction(valid)).toEqual({ kind: "unavailable" }); expect(createCompany).toHaveBeenCalledTimes(1);
});
it("sanitizes exceptions and load failures", async () => {
  vi.mocked(createCompany).mockRejectedValue(new Error("secret")); expect(await createCompanyAction(valid)).toEqual({ kind: "unavailable" });
  vi.mocked(getMyCompany).mockResolvedValue(fail(401, "unauthenticated")); expect(await loadCompanyStateAction()).toEqual({ kind: "unauthenticated" });
  vi.mocked(getMyCompany).mockResolvedValue(fail(503, "internal_error")); expect(await loadCompanyStateAction()).toEqual({ kind: "unavailable" });
  vi.mocked(getMyCompany).mockResolvedValue(fail(404, "not_found")); vi.mocked(listIndustries).mockResolvedValue(fail(503, "internal_error")); expect(await loadCompanyStateAction()).toEqual({ kind: "unavailable" });
});
