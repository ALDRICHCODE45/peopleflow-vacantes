"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getMyCompany, listIndustries, updateCompanyLocation, companyTimestampSchema } from "./api/company-client";
import type { Company, Industry, Membership, CompanyEditor } from "./api/company-client";
import { validateCompanyLocation, companyGeographyErrors } from "./validation";
import { createCompanyWithToken, reference, status, unavailable } from "./company-write";
import type { CompanyInput, CompanyFieldErrors } from "./validation";

import type { LocationWrite } from "@/features/geo/model";

export type UpdateCompanyLocationState =
  | { kind: "updated"; company: CompanyEditor }
  | { kind: "conflict"; company: CompanyEditor; reference: Reference }
  | Exclude<CreateCompanyState, { kind: "created" }>;

export type Reference = { status?: number; code?: string };
export type CompanyUnavailable = { kind: "server_error" | "no_response" | "unrecognized_response"; reference: Reference };
export type CompanyState =
  | { kind: "unauthenticated"; reference: Reference }
  | { kind: "exists"; company: Company; role: Membership["role"]; industryLabel: string; canViewTalentBase: boolean; /** Always set by loadCompanyStateAction; optional only for states built before stakeholder metrics v1. */ canViewMetrics?: boolean }
  | { kind: "none"; industries: Industry[] }
  | CompanyUnavailable;
export type CreateCompanyState =
  | { kind: "created"; company: Company }
  | { kind: "invalid"; fields?: CompanyFieldErrors; message?: string; reference: Reference }
  | { kind: "unauthenticated" | "forbidden" | "already_exists" | "industry_unavailable"; reference: Reference }
  | CompanyUnavailable;

export async function loadCompanyStateAction(): Promise<CompanyState> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated", reference: {} };
    const mine = await getMyCompany({ token });
    if (!mine.ok) {
      if (status(mine) === 401) return { kind: "unauthenticated", reference: reference(mine) };
      if (status(mine) !== 404 || mine.envelope?.code !== "not_found") return unavailable(mine);
      const industries = await listIndustries();
      return industries.ok ? { kind: "none", industries: industries.data } : unavailable(industries);
    }
    // An inactive/removed industry must not hide an existing membership.
    let industryLabel = "No disponible";
    try {
      const industries = await listIndustries();
      if (industries.ok) industryLabel = industries.data.find(item => item.id === mine.data.company.industry_id)?.label_es ?? industryLabel;
    } catch { /* Keep the authenticated company summary. */ }
    const { role, can } = mine.data;
    // A pre-v1 backend omits view_metrics; the contract grants it to owner and stakeholder only (D2).
    return { kind: "exists", company: mine.data.company, role, industryLabel, canViewTalentBase: can?.view_talent_base ?? true, canViewMetrics: can?.view_metrics ?? role !== "recruiter" };
  } catch {
    return unavailable();
  }
}

export async function updateCompanyLocationAction(input: { location: LocationWrite; updatedAt: string }): Promise<UpdateCompanyLocationState> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated", reference: {} };
    const issues = validateCompanyLocation(input?.location);
    if (issues.length) return { kind: "invalid", fields: { location: issues }, reference: {} };
    if (!companyTimestampSchema.safeParse(input?.updatedAt).success) return { kind: "unrecognized_response", reference: {} };
    const result = await updateCompanyLocation({ token, location: input.location, updatedAt: input.updatedAt });
    if (result.ok) return { kind: "updated", company: result.data };
    const ref = reference(result);
    const geography = companyGeographyErrors(status(result), result.envelope);
    if (geography) return { kind: "invalid", fields: { location: geography.location }, reference: ref };
    if (status(result) === 409 && result.envelope?.code === "conflict" && result.envelope.data) return { kind: "conflict", company: result.envelope.data, reference: ref };
    if (status(result) === 401) return { kind: "unauthenticated", reference: ref };
    if (status(result) === 403) return { kind: "forbidden", reference: ref };
    if (status(result) === 400 && result.envelope?.code === "invalid_request") return { kind: "invalid", reference: ref };
    return unavailable(result);
  } catch { return unavailable(); }
}

export async function createCompanyAction(input: CompanyInput): Promise<CreateCompanyState> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated", reference: {} };
    return await createCompanyWithToken(token, input);
  } catch {
    return unavailable();
  }
}
