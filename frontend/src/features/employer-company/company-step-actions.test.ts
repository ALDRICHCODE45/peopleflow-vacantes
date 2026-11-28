import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/features/identity/me-client", async importOriginal => ({ ...await importOriginal<typeof import("@/features/identity/me-client")>(), loadMe: vi.fn() }));
vi.mock("@/features/identity/employer-account-client", () => ({ createEmployerAccount: vi.fn() }));
vi.mock("./api/company-client", async importOriginal => ({ ...await importOriginal<typeof import("./api/company-client")>(), getMyCompany: vi.fn(), listIndustries: vi.fn(), createCompany: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { createEmployerAccount } from "@/features/identity/employer-account-client";
import { createCompany, getMyCompany, listIndustries } from "./api/company-client";
import { completeCompanyStepAction, loadCompanyStepAction } from "./company-step-actions";

const user = { id: "u", email: "andrea@altavista.mx", full_name: "Andrea Salinas" };
const company = { id: "c", name: "Grupo Altavista", rfc: "GAL010101AB1", industry_id: "i", status: "pending_verification" as const, location: null, updated_at: "2026-11-28T12:00:00Z" };
const industries = [{ id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 1 }];
const input = { fullName: "Andrea Salinas", name: " Grupo Altavista ", rfc: "gal010101ab1", industryId: "i", website: "grupoaltavista.mx" };
const fail = (status: number, code: string) => ({ ok: false as const, error: { kind: "status" as const, status, retryable: false as const }, envelope: { error: "upstream", code } });
const identityFail = (status: number, code: string) => ({ ok: false as const, error: { kind: "status" as const, status }, envelope: { error: "upstream", code } });
const recruiter = { ok: true as const, data: { role: "recruiter" as const, user } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActionAccessToken).mockResolvedValue("secret");
  vi.mocked(listIndustries).mockResolvedValue({ ok: true, data: industries });
  vi.mocked(createEmployerAccount).mockResolvedValue(recruiter);
  vi.mocked(createCompany).mockResolvedValue({ ok: true, data: company });
});

describe("loadCompanyStepAction", () => {
  it("fails closed without a session and reads nothing", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await loadCompanyStepAction()).toEqual({ kind: "unauthenticated" });
    expect(loadMe).not.toHaveBeenCalled();
  });

  it.each([[401, "unauthenticated", "unauthenticated"], [503, "identity_unavailable", "unavailable"], [500, "internal_error", "unavailable"]])("maps GET /v2/me %i to %s", async (status, code, kind) => {
    vi.mocked(loadMe).mockResolvedValue(identityFail(status, code));
    expect(await loadCompanyStepAction()).toEqual({ kind });
  });

  it("opens the form with the industries for an account without a users row", async () => {
    vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: null, user: null } });
    expect(await loadCompanyStepAction()).toEqual({ kind: "ready", industries });
    expect(getMyCompany).not.toHaveBeenCalled();
  });

  it("refuses a candidate account without reading companies", async () => {
    vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: "candidate", user } });
    expect(await loadCompanyStepAction()).toEqual({ kind: "candidate_account" });
    expect(getMyCompany).not.toHaveBeenCalled();
    expect(listIndustries).not.toHaveBeenCalled();
  });

  it("is done for a recruiter who already has a company (any role, incl. invited members)", async () => {
    vi.mocked(loadMe).mockResolvedValue(recruiter);
    vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: "c", role: "stakeholder", company } });
    expect(await loadCompanyStepAction()).toEqual({ kind: "done" });
  });

  it("opens the form for a recruiter without a company (404 not_found only)", async () => {
    vi.mocked(loadMe).mockResolvedValue(recruiter);
    vi.mocked(getMyCompany).mockResolvedValue(fail(404, "not_found"));
    expect(await loadCompanyStepAction()).toEqual({ kind: "ready", industries });
    vi.mocked(getMyCompany).mockResolvedValue(fail(404, "other"));
    expect(await loadCompanyStepAction()).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when the industries cannot be read or anything throws", async () => {
    vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { role: null, user: null } });
    vi.mocked(listIndustries).mockResolvedValue(fail(500, "internal_error"));
    expect(await loadCompanyStepAction()).toEqual({ kind: "unavailable" });
    vi.mocked(loadMe).mockRejectedValue(new Error("private"));
    expect(await loadCompanyStepAction()).toEqual({ kind: "unavailable" });
  });
});

describe("completeCompanyStepAction", () => {
  it("creates the employer account with the name, then the company, in that order", async () => {
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "created" });
    expect(createEmployerAccount).toHaveBeenCalledExactlyOnceWith({ token: "secret", body: { full_name: "Andrea Salinas" } });
    expect(createCompany).toHaveBeenCalledExactlyOnceWith({ token: "secret", body: { name: "Grupo Altavista", rfc: "GAL010101AB1", industry_id: "i", website: "https://grupoaltavista.mx" } });
    expect(vi.mocked(createEmployerAccount).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createCompany).mock.invocationCallOrder[0]);
  });

  it("fails closed without a session", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "unauthenticated" });
    expect(createEmployerAccount).not.toHaveBeenCalled();
  });

  it("validates every field before any write", async () => {
    expect(await completeCompanyStepAction({ fullName: "A", name: "Acm", rfc: "X", industryId: " ", website: "nope" })).toEqual({ kind: "invalid", fields: {
      fullName: "Escribe un nombre de 2 a 120 caracteres.",
      name: "El nombre debe tener al menos 4 caracteres.",
      rfc: "El RFC debe tener exactamente 12 caracteres.",
      industryId: "Selecciona una industria.",
      website: "Escribe un sitio válido, como grupoaltavista.mx.",
    } });
    expect(await completeCompanyStepAction(null)).toMatchObject({ kind: "invalid" });
    expect(createEmployerAccount).not.toHaveBeenCalled();
    expect(createCompany).not.toHaveBeenCalled();
  });

  it.each([
    [409, "account_exists", "candidate_account"],
    [409, "email_in_use", "email_in_use"],
    [422, "email_not_verified", "email_not_verified"],
    [401, "unauthenticated", "unauthenticated"],
    [503, "identity_unavailable", "unavailable"],
    [500, "internal_error", "unavailable"],
  ])("stops on employer-account %i %s → %s without creating a company", async (status, code, kind) => {
    vi.mocked(createEmployerAccount).mockResolvedValue(identityFail(status, code));
    expect(await completeCompanyStepAction(input)).toEqual({ kind });
    expect(createCompany).not.toHaveBeenCalled();
  });

  it("maps a server-side name rejection to the name field", async () => {
    vi.mocked(createEmployerAccount).mockResolvedValue(identityFail(400, "validation_error"));
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "invalid", fields: { fullName: "Escribe un nombre de 2 a 120 caracteres." } });
  });

  it("is idempotent: a repeated submit whose company already exists for this account counts as created", async () => {
    vi.mocked(createEmployerAccount).mockResolvedValue(recruiter); // 200 on retry
    vi.mocked(createCompany).mockResolvedValue(fail(409, "already_exists"));
    vi.mocked(getMyCompany).mockResolvedValue({ ok: true, data: { company_id: "c", role: "owner", company } });
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "created" });
    expect(createCompany).toHaveBeenCalledTimes(1);
  });

  it("reports a duplicate RFC on the RFC field when this account has no company", async () => {
    vi.mocked(createCompany).mockResolvedValue(fail(409, "already_exists"));
    vi.mocked(getMyCompany).mockResolvedValue(fail(404, "not_found"));
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "invalid", fields: { rfc: "Ese RFC ya está registrado." } });
  });

  it.each([
    [403, "forbidden", { kind: "forbidden" }],
    [401, "unauthenticated", { kind: "unauthenticated" }],
    [409, "industry_unavailable", { kind: "industry_unavailable" }],
    [500, "internal_error", { kind: "unavailable" }],
  ])("maps POST /companies %i %s", async (status, code, expected) => {
    vi.mocked(createCompany).mockResolvedValue(fail(status, code));
    expect(await completeCompanyStepAction(input)).toEqual(expected);
  });

  it("never leaks an exception", async () => {
    vi.mocked(createCompany).mockRejectedValue(new Error("private"));
    expect(await completeCompanyStepAction(input)).toEqual({ kind: "unavailable" });
  });
});
