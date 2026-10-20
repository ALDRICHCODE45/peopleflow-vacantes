import { z } from "zod";
import { locationWriteSchema, parseGeographyErrors, type LocationWrite, type LocationIssue } from "@/features/geo/model";

export type CompanyInput = { name: string; rfc: string; industryId: string; location?: LocationWrite };
export type CompanyFieldErrors = Partial<Record<"name" | "rfc" | "industryId", string>> & { location?: LocationIssue[] };

export function validateCompanyLocation(location: unknown): LocationIssue[] {
  const parsed = locationWriteSchema.safeParse(location);
  return parsed.success ? [] : parsed.error.issues.map(issue => ({ field: (["country", "state", "municipality", "postal_code"].includes(String(issue.path[0])) ? issue.path[0] : "country") as LocationIssue["field"], reason: "unknown" }));
}

export function companyGeographyErrors(status: number | undefined, body: unknown) {
  const envelope = z.object({ code: z.literal("invalid_location"), error: z.string(), details: z.array(z.object({ field: z.string().regex(/^location\.(country|state|municipality|postal_code)$/), reason: z.string() }).strict()) }).strict().safeParse(body);
  if (!envelope.success) return null;
  // Company paths omit the vacancy-only `fields.` prefix required by the shared parser.
  return parseGeographyErrors(status, { ...envelope.data, details: envelope.data.details.map(issue => ({ ...issue, field: `fields.${issue.field}` })) });
}

/**
 * Mirrors the Go contract (backend 44d8468): lengths count characters (code
 * points, like utf8.RuneCountInString), so Ñ and & count as one. No RFC regex
 * and no invented maximum.
 */
export function validateCompany(input: CompanyInput) {
  const value = {
    name: typeof input?.name === "string" ? input.name.trim() : "",
    rfc: typeof input?.rfc === "string" ? input.rfc.trim().toUpperCase() : "",
    industryId: typeof input?.industryId === "string" ? input.industryId.trim() : "",
    ...(input?.location === undefined ? {} : { location: input.location }),
  };
  const characters = (text: string) => Array.from(text).length;
  const fields: CompanyFieldErrors = {};
  if (characters(value.name) < 4) fields.name = "El nombre debe tener al menos 4 caracteres.";
  if (characters(value.rfc) !== 12) fields.rfc = "El RFC debe tener exactamente 12 caracteres.";
  if (!value.industryId) fields.industryId = "Selecciona una industria.";
  if (input?.location !== undefined) {
    const issues = validateCompanyLocation(input.location);
    if (issues.length) fields.location = issues;
  }
  return { value, fields };
}
