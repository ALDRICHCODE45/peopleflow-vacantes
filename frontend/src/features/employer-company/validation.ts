export type CompanyInput = { name: string; rfc: string; industryId: string };
export type CompanyFieldErrors = Partial<Record<keyof CompanyInput, string>>;

/** Mirrors the Go contract: UTF-8 bytes, no RFC regex or invented maximum. */
export function validateCompany(input: CompanyInput) {
  const value = {
    name: typeof input?.name === "string" ? input.name.trim() : "",
    rfc: typeof input?.rfc === "string" ? input.rfc.trim().toUpperCase() : "",
    industryId: typeof input?.industryId === "string" ? input.industryId.trim() : "",
  };
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  const fields: CompanyFieldErrors = {};
  // A name of more than 3 bytes always has at least 4 characters when it fails.
  if (bytes(value.name) <= 3) fields.name = "El nombre debe tener al menos 4 caracteres.";
  if (bytes(value.rfc) !== 12) {
    // The API counts bytes, so 12 characters with Ñ or accents are still rejected.
    fields.rfc = Array.from(value.rfc).length === 12
      ? "Por ahora el RFC no puede incluir Ñ ni letras con acento."
      : "El RFC debe tener exactamente 12 caracteres.";
  }
  if (!value.industryId) fields.industryId = "Selecciona una industria.";
  return { value, fields };
}
