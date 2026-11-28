import "server-only";
import { createCompany, type CompanyFailure } from "./api/company-client";
import type { CompanyUnavailable, CreateCompanyState, Reference } from "./actions";
import { companyGeographyErrors, validateCompany, type CompanyInput } from "./validation";

/*
 * Server-only helpers behind the company Server Actions. Kept outside the
 * "use server" modules on purpose: every export there becomes a callable
 * action, and createCompanyWithToken takes a token argument.
 */

export function status(result: CompanyFailure): number | undefined {
  return "status" in result.error ? result.error.status : undefined;
}
export function reference(result: CompanyFailure): Reference {
  return { ...(status(result) === undefined ? {} : { status: status(result) }), ...(result.envelope ? { code: result.envelope.code } : {}) };
}
export function unavailable(result?: CompanyFailure): CompanyUnavailable {
  const http = result && status(result);
  const kind = http !== undefined && http >= 500 && http < 600 ? "server_error"
    : !result || result.error.kind === "network" || result.error.kind === "timeout" ? "no_response" : "unrecognized_response";
  return { kind, reference: result ? reference(result) : {} };
}

/** POST /companies for an already resolved token (Configuración and «Tu empresa»). */
export async function createCompanyWithToken(token: string, input: CompanyInput): Promise<CreateCompanyState> {
  const { value, fields } = validateCompany(input);
  if (Object.keys(fields).length) return { kind: "invalid", fields, reference: {} };
  const result = await createCompany({ token, body: { name: value.name, rfc: value.rfc, industry_id: value.industryId, ...(value.location === undefined ? {} : { location: value.location }), ...("website" in value ? { website: value.website } : {}) } });
  if (result.ok) return { kind: "created", company: result.data };
  const code = result.envelope?.code;
  const ref = reference(result);
  const geography = companyGeographyErrors(status(result), result.envelope);
  if (geography) return { kind: "invalid", fields: { location: geography.location }, reference: ref };
  switch (status(result)) {
    case 401: return { kind: "unauthenticated", reference: ref };
    case 403: return { kind: "forbidden", reference: ref };
    case 400:
      if (code === "invalid_request" && result.envelope?.error) return { kind: "invalid", message: result.envelope.error, reference: ref };
      break;
    case 409:
      if (code === "already_exists" || code === "industry_unavailable") return { kind: code, reference: ref };
  }
  return unavailable(result);
}
