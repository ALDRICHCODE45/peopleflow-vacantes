import type { LocationValue } from "@/features/geo/model";
import { uploadValidation } from "@/features/candidate-cvs/model";
import { candidateSchema, phoneSchema, cvLimits, type Candidate, type FieldIssue, type IntakeBody } from "./model";
import type { EducationDraft } from "@/features/candidate/profile-draft";
import type { LanguageValue } from "@/features/languages/language-field";
export type Draft = {
  full_name: string; email: string; phone: string; dial: string; education: EducationDraft[]; residence: LocationValue;
  professional_title: string; current_company: string; years_of_experience: string; seniority: string; summary: string; skills: string;
  languages: LanguageValue[]; linkedin_url: string; portfolio_url: string;
};
export const emptyDraft = (): Draft => ({ full_name: "", email: "", phone: "", dial: "+52", education: [{ level: "", institution: "", field: "", status: "", start_year: "", end_year: "" }], residence: { country: null, state: null, municipality: null, postal_code: null }, professional_title: "", current_company: "", years_of_experience: "", seniority: "", summary: "", skills: "", languages: [], linkedin_url: "", portfolio_url: "" });
export function phoneValue(dial: string, phone: string): string | null {
  if (!phone.trim()) return null;
  const digits = phone.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{0,2}$/.test(dial) || !/^\d+$/.test(digits) || !phoneSchema.safeParse(dial + digits).success) return null;
  return dial + digits;
}
export function contact(draft: Draft) { return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? draft.email.trim() : null, phone: phoneValue(draft.dial, draft.phone) }; }
export type Errors = Record<string, string>;
export function serverErrors(issues: FieldIssue[]): Errors {
 const messages = { required: "Completa este dato.", invalid: "Revisa este dato.", too_long: "Este dato es demasiado largo.", not_allowed: "Este dato no se permite aquí.", duplicate: "Quita el valor repetido." };
 const errors: Errors = {};
 for (const issue of issues) {
  let path = issue.field.replace(/^data\./, "").replace(/^candidate\./, "");
  if (path === "stage_id") {
   errors.stage_id = issue.code === "required" ? "Elige una etapa de ingreso." : issue.code === "not_allowed" ? "Esta etapa no permite ingresos. Elige otra." : "Elige una etapa de ingreso válida.";
   continue;
  }
  if (path === "candidate") path = "full_name";
  if (path === "contact") { errors.contact = "Agrega un correo o un teléfono."; continue; }
  if (path === "residence") path = "residence.country";
  if (path.startsWith("skills[")) path = "skills";
  const residenceRequired: Errors = { "residence.country": "Elige un país.", "residence.state": "Elige un estado.", "residence.municipality": "Elige un municipio." };
  errors[path] ??= (issue.code === "required" ? path === "education" ? "Agrega al menos un estudio." : residenceRequired[path] : undefined) ?? messages[issue.code];
 }
 return errors;
}
export function prepare(draft: Draft, stage: string, existing: IntakeBody["existing"], distinct: boolean, file: File | null, stages: readonly string[]): { errors: Errors; body: IntakeBody } {
 const errors: Errors = {};
 if (!stages.includes(stage)) errors.stage_id = "Elige una etapa activa.";
 const year = (value: string) => value === "" ? null : /^\d+$/.test(value) ? Number(value) : NaN;
 const raw: Record<string, unknown> = { full_name: draft.full_name.trim(), education: draft.education.map(study => ({ ...study, institution: study.institution.trim() || null, field: study.field.trim() || null, start_year: year(study.start_year), end_year: year(study.end_year) })), years_of_experience: draft.years_of_experience || null, seniority: draft.seniority || null, languages: draft.languages, email: draft.email.trim() || null, phone: phoneValue(draft.dial, draft.phone), residence: draft.residence };
 for (const key of ["professional_title", "current_company", "summary", "linkedin_url", "portfolio_url"] as const) if (draft[key].trim()) raw[key] = draft[key].trim();
 if (draft.skills.trim()) raw.skills = [...new Set(draft.skills.split(/[,\n]/).map(value => value.trim().toLowerCase()).filter(Boolean))];
 if (!existing) {
  if (!raw.full_name) errors.full_name = "Escribe el nombre completo.";
  if (!draft.email.trim() && !draft.phone.trim()) errors.contact = "Agrega un correo o un teléfono.";
  if (draft.phone.trim() && !raw.phone) errors.phone = draft.dial === "+52" ? "Escribe los 10 dígitos del teléfono en México." : "Escribe una lada y un número válidos, de 8 a 15 dígitos en total.";
  if (!draft.education.length) errors.education = "Agrega al menos un estudio.";
  if (!draft.residence.country) errors["residence.country"] = "Elige un país.";
  if (draft.residence.country === "MX") {
   if (!draft.residence.state) errors["residence.state"] = "Elige un estado.";
   if (!draft.residence.municipality) errors["residence.municipality"] = "Elige un municipio.";
  }
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) for (const issue of parsed.error.issues) {
   const path = issue.path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`).join("");
   const key = path.startsWith("skills") ? "skills" : path;
   errors[key] ??= issue.code === "custom" ? issue.message : "Revisa este dato.";
  }
 }
 const fileError = file ? uploadValidation(file, cvLimits) : "Selecciona un CV.";
 if (fileError) errors.cv = fileError;
 return { errors, body: { stage_id: stage, existing, confirmed_distinct: existing ? false : distinct, candidate: existing ? null : raw as Candidate } };
}
