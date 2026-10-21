import type { LocationValue } from "@/features/geo/model";
import { uploadValidation } from "@/features/candidate-cvs/model";
import { candidateSchema, cvLimits, type Candidate, type FieldIssue, type IntakeBody } from "./model";
export type Draft = {
  full_name: string; email: string; phone: string; dial: string; education_level: string; residence: LocationValue;
  professional_title: string; current_company: string; field_of_study: string; experience_years: string; summary: string; skills: string;
  languages: { language: string; level: string }[]; linkedin_url: string; portfolio_url: string;
};
export const emptyDraft = (): Draft => ({ full_name: "", email: "", phone: "", dial: "+52", education_level: "", residence: { country: null, state: null, municipality: null, postal_code: null }, professional_title: "", current_company: "", field_of_study: "", experience_years: "", summary: "", skills: "", languages: [], linkedin_url: "", portfolio_url: "" });
export function phoneValue(dial: string, phone: string): string | null {
  if (!phone.trim()) return null;
  const digits = phone.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{0,2}$/.test(dial) || !(dial === "+52" ? /^\d{10}$/ : /^\d{6,14}$/).test(digits) || dial.length - 1 + digits.length > 15) return null;
  return dial + digits;
}
export function contact(draft: Draft) { return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? draft.email.trim() : null, phone: phoneValue(draft.dial, draft.phone) }; }
export type Errors = Record<string, string>;
export function serverErrors(issues: FieldIssue[]): Errors {
 const messages = { required: "Completa este dato.", invalid: "Revisa este dato.", too_long: "Este dato es demasiado largo.", not_allowed: "Este dato no se permite aquí.", duplicate: "Quita el valor repetido." };
 const errors: Errors = {};
 for (const issue of issues) {
  let path = issue.field.replace(/^candidate\./, "");
  if (path === "candidate") path = "full_name";
  if (path === "contact") path = "email";
  if (path === "residence") path = "residence.country";
  if (path.startsWith("skills[")) path = "skills";
  errors[path] ??= messages[issue.code];
 }
 return errors;
}
export function prepare(draft: Draft, stage: string, existing: IntakeBody["existing"], distinct: boolean, file: File | null, stages: readonly string[]): { errors: Errors; body: IntakeBody } {
 const errors: Errors = {};
 if (!stages.includes(stage)) errors.stage_id = "Elige una etapa activa.";
 const raw: Record<string, unknown> = { full_name: draft.full_name.trim(), education_level: draft.education_level, email: draft.email.trim() || null, phone: phoneValue(draft.dial, draft.phone), residence: draft.residence };
 for (const key of ["professional_title", "current_company", "field_of_study", "summary", "linkedin_url", "portfolio_url"] as const) if (draft[key].trim()) raw[key] = draft[key].trim();
 if (draft.experience_years.trim()) raw.experience_years = Number(draft.experience_years);
 if (draft.skills.trim()) raw.skills = [...new Set(draft.skills.split(/[,\n]/).map(value => value.trim().toLowerCase()).filter(Boolean))];
 if (draft.languages.length) raw.languages = draft.languages.map(row => ({ language: row.language.trim(), level: row.level }));
 if (!existing) {
  if (!raw.full_name) errors.full_name = "Escribe el nombre completo.";
  if (!draft.email.trim() && !draft.phone.trim()) errors.email = "Agrega un correo o un teléfono.";
  if (draft.phone.trim() && !raw.phone) errors.phone = draft.dial === "+52" ? "Escribe los 10 dígitos del teléfono en México." : "Escribe una lada válida y entre 6 y 14 dígitos.";
  if (!draft.education_level) errors.education_level = "Selecciona el nivel de estudios.";
  if (!draft.residence.country) errors["residence.country"] = "Elige un país.";
  if (draft.residence.country === "MX") {
   if (!draft.residence.state) errors["residence.state"] = "Elige un estado.";
   if (!draft.residence.municipality) errors["residence.municipality"] = "Elige un municipio.";
  }
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) for (const issue of parsed.error.issues) {
   const path = issue.path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`).join("");
   const key = path.startsWith("skills") ? "skills" : path;
   errors[key] ??= "Revisa este dato.";
  }
  const seen = new Set<string>();
  draft.languages.forEach((row, i) => { const name = row.language.trim().toLowerCase(); if (seen.has(name)) errors[`languages[${i}].language`] = "Quita el idioma repetido."; seen.add(name); });
 }
 const fileError = file ? uploadValidation(file, cvLimits) : "Selecciona un CV.";
 if (fileError) errors.cv = fileError;
 return { errors, body: { stage_id: stage, existing, confirmed_distinct: existing ? false : distinct, candidate: existing ? null : raw as Candidate } };
}
