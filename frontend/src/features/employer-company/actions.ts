"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { createCompany, getMyCompany, listIndustries } from "./api/company-client";
import type { Company, Industry, Membership, CompanyFailure } from "./api/company-client";
import { validateCompany } from "./validation";
import type { CompanyInput, CompanyFieldErrors } from "./validation";

export type CompanyState =
  | { kind: "unauthenticated" }
  | { kind: "exists"; company: Company; role: Membership["role"]; industryLabel: string }
  | { kind: "none"; industries: Industry[] }
  | { kind: "unavailable" };
export type CreateCompanyState =
  | { kind: "created"; company: Company }
  | { kind: "invalid"; fields?: CompanyFieldErrors; message?: string }
  | { kind: "unauthenticated" | "forbidden" | "already_exists" | "industry_unavailable" | "unavailable" };

function status(result: CompanyFailure): number | undefined {
  return "status" in result.error ? result.error.status : undefined;
}

export async function loadCompanyStateAction(): Promise<CompanyState> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated" };
    const mine = await getMyCompany({ token });
    if (!mine.ok) {
      if (status(mine) === 401) return { kind: "unauthenticated" };
      if (status(mine) !== 404 || mine.envelope?.code !== "not_found") return { kind: "unavailable" };
      const industries = await listIndustries();
      return industries.ok ? { kind: "none", industries: industries.data } : { kind: "unavailable" };
    }
    // An inactive/removed industry must not hide an existing membership.
    let industryLabel = "No disponible";
    try {
      const industries = await listIndustries();
      if (industries.ok) industryLabel = industries.data.find(item => item.id === mine.data.company.industry_id)?.label_es ?? industryLabel;
    } catch { /* Keep the authenticated company summary. */ }
    return { kind: "exists", company: mine.data.company, role: mine.data.role, industryLabel };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function createCompanyAction(input: CompanyInput): Promise<CreateCompanyState> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated" };
    const { value, fields } = validateCompany(input);
    if (Object.keys(fields).length) return { kind: "invalid", fields };
    const result = await createCompany({ token, body: { name: value.name, rfc: value.rfc, industry_id: value.industryId } });
    if (result.ok) return { kind: "created", company: result.data };
    const code = result.envelope?.code;
    switch (status(result)) {
      case 401: return { kind: "unauthenticated" };
      case 403: return { kind: "forbidden" };
      case 400:
        if (code === "invalid_request" && result.envelope?.error) return { kind: "invalid", message: result.envelope.error };
        break;
      case 409:
        if (code === "already_exists" || code === "industry_unavailable") return { kind: code };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
