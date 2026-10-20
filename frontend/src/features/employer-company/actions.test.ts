import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./api/company-client", async importOriginal => ({ ...await importOriginal<typeof import("./api/company-client")>(), getMyCompany: vi.fn(), listIndustries: vi.fn(), createCompany: vi.fn(), updateCompanyLocation: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { createCompany, getMyCompany, listIndustries, updateCompanyLocation } from "./api/company-client";
import { createCompanyAction, loadCompanyStateAction, updateCompanyLocationAction } from "./actions";
const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00.123456789Z" };
const industries = [{ id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 1 }];
const valid = { name: " Empresa ", rfc: " abc123456789 ", industryId: " i " };
const fail = (status: number, code: string, error = "upstream") => ({ ok: false as const, error: { kind: "status" as const, status, retryable: false as const }, envelope: { error, code } });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); vi.mocked(listIndustries).mockResolvedValue({ ok: true, data: industries }); });
it.each([500, 502, 302, 409])("classifies HTTP %s and preserves safe reference on create and load", async status => {
  const failure = fail(status, "internal_error");
  vi.mocked(createCompany).mockResolvedValue(failure);
  vi.mocked(getMyCompany).mockResolvedValue(failure);
  const expected = { kind: status >= 500 ? "server_error" : "unrecognized_response", reference: { status, code: "internal_error" } };
  expect(await createCompanyAction(valid)).toEqual(expected);
  expect(await loadCompanyStateAction()).toEqual(expected);
});
it("fails closed without session for read and create", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadCompanyStateAction()).toEqual({ kind: "unauthenticated", reference: {} });
  expect(await createCompanyAction(valid)).toEqual({ kind: "unauthenticated", reference: {} });
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
  expect(await loadCompanyStateAction()).toEqual({ kind: "unrecognized_response", reference: {status:404,code:"other"} });
});
it("keeps existing summary when industry lookup fails", async () => {
  vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: "c", role: "owner", company } });
  vi.mocked(listIndustries).mockRejectedValue(new Error("private"));
  expect(await loadCompanyStateAction()).toMatchObject({ kind: "exists", industryLabel: "No disponible" });
});
it.each([null, { country: "MX", state: "01", municipality: "01001", postal_code: "01000" }])("posts optional location codes %j", async location => {
  vi.mocked(createCompany).mockResolvedValue({ ok: true, data: company });
  await createCompanyAction({ ...valid, location });
  expect(createCompany).toHaveBeenCalledWith({ token: "secret", body: { name: "Empresa", rfc: "ABC123456789", industry_id: "i", location } });
});
it.each(["country", "state", "municipality", "postal_code"])("maps location.%s validation to the matching field", async field => {
  vi.mocked(createCompany).mockResolvedValue({ ...fail(422, "invalid_location"), envelope: { error: "invalid location", code: "invalid_location", details: [{ field: `location.${field}`, reason: "unknown" }] } });
  expect(await createCompanyAction(valid)).toMatchObject({ kind: "invalid", fields: { location: [{ field, reason: "unknown" }] }, reference: { status: 422, code: "invalid_location" } });
});
it("returns current editor data on conflict without retrying the update", async () => {
  const editor = { id: company.id, name: company.name, location: null, updated_at: company.updated_at };
  vi.mocked(updateCompanyLocation).mockResolvedValue({ ...fail(409, "conflict"), envelope: { error: "conflict", code: "conflict", data: editor } });
  expect(await updateCompanyLocationAction({ location: null, updatedAt: company.updated_at })).toEqual({ kind: "conflict", company: editor, reference: { status: 409, code: "conflict" } });
  expect(updateCompanyLocation).toHaveBeenCalledExactlyOnceWith({ token: "secret", location: null, updatedAt: company.updated_at });
});
it("rejects malformed location writes before create or update", async () => {
  const location = { country: { id: "MX", name: "México" } } as unknown as import("@/features/geo/model").LocationWrite;
  expect(await createCompanyAction({ ...valid, location })).toMatchObject({ kind: "invalid" });
  expect(await updateCompanyLocationAction({ location, updatedAt: company.updated_at })).toMatchObject({ kind: "invalid" });
  expect(createCompany).not.toHaveBeenCalled(); expect(updateCompanyLocation).not.toHaveBeenCalled();
});
it.each(["required", "unknown", "mismatch", "not_allowed"])("maps update location validation reason %s", async reason => {
  vi.mocked(updateCompanyLocation).mockResolvedValue({ ...fail(422, "invalid_location"), envelope: { error: "invalid location", code: "invalid_location", details: [{ field: "location.postal_code", reason }] } });
  expect(await updateCompanyLocationAction({ location: null, updatedAt: company.updated_at })).toMatchObject({ kind: "invalid", fields: { location: [{ field: "postal_code", reason }] } });
});
it("fails closed on unknown geography reasons and conflict without editor data", async () => {
  for (const failure of [{ ...fail(422, "invalid_location"), envelope: { error: "invalid location", code: "invalid_location", details: [{ field: "location.country", reason: "invented" }] } }, fail(409, "conflict")]) {
    vi.mocked(updateCompanyLocation).mockResolvedValue(failure);
    expect(await updateCompanyLocationAction({ location: null, updatedAt: company.updated_at })).toMatchObject({ kind: "unrecognized_response" });
  }
});
it.each([401, 403, 500])("maps update HTTP %s", async status => {
  vi.mocked(updateCompanyLocation).mockResolvedValue(fail(status, "failure"));
  expect(await updateCompanyLocationAction({ location: null, updatedAt: company.updated_at })).toMatchObject({ kind: status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : "server_error" });
});
it("does not update without session or a valid CAS token", async () => {
  expect(await updateCompanyLocationAction({ location: null, updatedAt: "invalid" })).toMatchObject({ kind: "unrecognized_response" });
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await updateCompanyLocationAction({ location: null, updatedAt: company.updated_at })).toMatchObject({ kind: "unauthenticated" });
  expect(updateCompanyLocation).not.toHaveBeenCalled();
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
  [500, "internal_error", "server_error", "secret"],
  [413, "too_large", "unrecognized_response", "secret"],
])("maps %s %s to %s", async (status, code, kind, message) => {
  vi.mocked(createCompany).mockResolvedValue(fail(status, code, message));
  const result = await createCompanyAction(valid); expect(result).toMatchObject({ kind, reference: {status,code} });
  if (kind === "invalid") expect(result).toMatchObject({ message }); else expect(JSON.stringify(result)).not.toContain("secret");
  expect(createCompany).toHaveBeenCalledTimes(1);
});
it.each(["network", "timeout", "invalid_response"] as const)("sanitizes %s failures without retry", async kind => {
  const failure = { ok: false as const, error: { kind, retryable: false as const } };
  vi.mocked(createCompany).mockResolvedValue(failure);
  vi.mocked(getMyCompany).mockResolvedValue(failure);
  const expected = {kind: kind === "invalid_response" ? "unrecognized_response" : "no_response", reference:{}};
  expect(await createCompanyAction(valid)).toEqual(expected);
  expect(await loadCompanyStateAction()).toEqual(expected);
  expect(createCompany).toHaveBeenCalledTimes(1);
});
it("sanitizes exceptions and load failures", async () => {
  vi.mocked(createCompany).mockRejectedValue(new Error("secret")); expect(await createCompanyAction(valid)).toEqual({ kind: "no_response", reference: {} });
  vi.mocked(getMyCompany).mockResolvedValue(fail(401, "unauthenticated")); expect(await loadCompanyStateAction()).toEqual({ kind: "unauthenticated", reference: {status:401,code:"unauthenticated"} });
  vi.mocked(getMyCompany).mockResolvedValue(fail(503, "internal_error")); expect(await loadCompanyStateAction()).toEqual({ kind: "server_error", reference: {status:503,code:"internal_error"} });
  vi.mocked(getMyCompany).mockResolvedValue(fail(404, "not_found")); vi.mocked(listIndustries).mockResolvedValue(fail(503, "internal_error")); expect(await loadCompanyStateAction()).toEqual({ kind: "server_error", reference: {status:503,code:"internal_error"} });
});
