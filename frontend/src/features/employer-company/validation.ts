export type CompanyInput = { name: string; rfc: string; industryId: string };
export type CompanyFieldErrors = Partial<Record<keyof CompanyInput, string>>;

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
  };
  const characters = (text: string) => Array.from(text).length;
  const fields: CompanyFieldErrors = {};
  if (characters(value.name) < 4) fields.name = "El nombre debe tener al menos 4 caracteres.";
  if (characters(value.rfc) !== 12) fields.rfc = "El RFC debe tener exactamente 12 caracteres.";
  if (!value.industryId) fields.industryId = "Selecciona una industria.";
  return { value, fields };
}
