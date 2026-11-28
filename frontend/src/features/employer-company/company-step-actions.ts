"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { createEmployerAccount } from "@/features/identity/employer-account-client";
import { loadMe, type ClientFailure } from "@/features/identity/me-client";
import { normalizedName, validName } from "@/features/identity/model";
import { getMyCompany, listIndustries } from "./api/company-client";
import { createCompanyWithToken, status } from "./company-write";
import { FULL_NAME_ERROR, RFC_TAKEN_ERROR, type CompanyStepFieldErrors, type CompanyStepInput, type CompanyStepLoad, type CompanyStepResult } from "./company-step";
import { validateCompany } from "./validation";

/*
 * «Tu empresa» (A4.5). Both actions resolve the token server-side; the browser
 * never sees it. CSRF: same-origin Server Actions only (see lib/auth/sign-up/actions.ts).
 */

const UNAVAILABLE = { kind: "unavailable" } as const;

async function industriesOrUnavailable(): Promise<CompanyStepLoad> {
  const industries = await listIndustries();
  return industries.ok ? { kind: "ready", industries: industries.data } : UNAVAILABLE;
}

/** What the step shows: the form (with industries), «done», a candidate account, or a failure. Reads only. */
export async function loadCompanyStepAction(): Promise<CompanyStepLoad> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated" };
    const me = await loadMe({ token });
    if (!me.ok) return me.error.status === 401 || me.error.kind === "missing_token" ? { kind: "unauthenticated" } : UNAVAILABLE;
    if (me.data.role === "candidate") return { kind: "candidate_account" };
    if (me.data.role === null) return await industriesOrUnavailable();
    const mine = await getMyCompany({ token });
    if (mine.ok) return { kind: "done" };
    if (status(mine) === 401) return { kind: "unauthenticated" };
    if (status(mine) === 404 && mine.envelope?.code === "not_found") return await industriesOrUnavailable();
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function employerAccountFailure({ error, envelope }: ClientFailure): CompanyStepResult {
  const code = envelope?.code;
  if (error.kind === "missing_token" || error.status === 401) return { kind: "unauthenticated" };
  if (error.kind === "invalid_request" || (error.status === 400 && code === "validation_error")) return { kind: "invalid", fields: { fullName: FULL_NAME_ERROR } };
  if (error.status === 409 && code === "account_exists") return { kind: "candidate_account" };
  if (error.status === 409 && code === "email_in_use") return { kind: "email_in_use" };
  if (error.status === 422 && code === "email_not_verified") return { kind: "email_not_verified" };
  return UNAVAILABLE;
}

/**
 * POST /v2/me/employer-account {full_name}, then POST /companies. Safe to
 * repeat: the account answers 200 when it is already a recruiter, and a
 * company that already exists for this account (a double submit whose first
 * request landed) counts as created; only then is 409 already_exists the RFC.
 */
export async function completeCompanyStepAction(input: unknown): Promise<CompanyStepResult> {
  try {
    const raw = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<keyof CompanyStepInput, unknown>>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const fullName = normalizedName(text(raw.fullName));
    const company = { name: text(raw.name), rfc: text(raw.rfc), industryId: text(raw.industryId), ...(typeof raw.website === "string" ? { website: raw.website } : {}) };
    const fields: CompanyStepFieldErrors = { ...(validName(fullName) ? {} : { fullName: FULL_NAME_ERROR }), ...validateCompany(company).fields };
    if (Object.keys(fields).length) return { kind: "invalid", fields };

    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated" };

    const account = await createEmployerAccount({ token, body: { full_name: fullName } });
    if (!account.ok) return employerAccountFailure(account);

    const created = await createCompanyWithToken(token, company);
    switch (created.kind) {
      case "created":
        return { kind: "created" };
      case "already_exists": {
        const mine = await getMyCompany({ token });
        if (mine.ok) return { kind: "created" };
        return status(mine) === 404 && mine.envelope?.code === "not_found" ? { kind: "invalid", fields: { rfc: RFC_TAKEN_ERROR } } : UNAVAILABLE;
      }
      case "invalid":
        return { kind: "invalid", fields: created.fields ?? {}, ...(created.message ? { message: created.message } : {}) };
      case "unauthenticated":
      case "forbidden":
      case "industry_unavailable":
        return { kind: created.kind };
      default:
        return UNAVAILABLE;
    }
  } catch {
    return UNAVAILABLE;
  }
}
