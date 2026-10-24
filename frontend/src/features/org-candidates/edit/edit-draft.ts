import { locationReadToValue, locationValueToWrite, type LocationValue } from "@/features/geo/model";
import { phoneToDraft, phoneValue, phoneError } from "@/lib/phone";
import { EDUCATION_LEVEL_LABELS, EDUCATION_STATUS_LABELS, CEFR_LEVEL_LABELS, SENIORITY_LABELS } from "@/features/candidate/model";
import type { EducationDraft } from "@/features/candidate/profile-draft";
import type { LanguageValue } from "@/features/languages/language-field";
import { CANDIDATE_EDIT_FIELDS, buildCandidateEditBody, candidateEditValuesSchema, type CandidateEditField, type CandidateEditValues, type EditableOrgCandidate } from "./edit-model";
import { parseSkills } from "@/lib/skills";
export type CandidateEditDraft = {
 full_name: string; email: string; dial: string; phone: string; location: LocationValue;
 professional_title: string; current_company: string; seniority: string; years_of_experience: string;
 education: EducationDraft[]; languages: LanguageValue[]; skills: string; linkedin_url: string; portfolio_url: string;
};
export function candidateEditValues(candidate: EditableOrgCandidate): CandidateEditValues {
 return {
  full_name: candidate.full_name, email: candidate.contact.email, phone: candidate.contact.phone,
  location: locationValueToWrite(locationReadToValue(candidate.profile.location)),
  professional_title: candidate.professional_title, current_company: candidate.current_company,
  seniority: candidate.profile.seniority, years_of_experience: candidate.profile.years_of_experience,
  education: candidate.education, languages: candidate.profile.languages, skills: candidate.skills,
  linkedin_url: candidate.linkedin_url, portfolio_url: candidate.portfolio_url,
 };
}
export function valuesToEditDraft(values: CandidateEditValues): CandidateEditDraft {
 return {
  full_name: values.full_name ?? "", email: values.email ?? "", ...phoneToDraft(values.phone),
  location: { country: values.location?.country ?? null, state: values.location?.state ?? null, municipality: values.location?.municipality ?? null, postal_code: values.location?.postal_code ?? null },
  professional_title: values.professional_title ?? "", current_company: values.current_company ?? "",
  seniority: values.seniority ?? "", years_of_experience: values.years_of_experience ?? "",
  education: (values.education ?? []).map(row => ({ ...row, institution: row.institution ?? "", field: row.field ?? "", start_year: row.start_year === null ? "" : String(row.start_year), end_year: row.end_year === null ? "" : String(row.end_year) })),
  languages: values.languages ?? [], skills: (values.skills ?? []).join(", "), linkedin_url: values.linkedin_url ?? "", portfolio_url: values.portfolio_url ?? "",
 };
}
export function editedDraftFields(baseline: CandidateEditDraft, draft: CandidateEditDraft): CandidateEditField[] {
 return CANDIDATE_EDIT_FIELDS.filter(field => JSON.stringify(baseline[field]) !== JSON.stringify(draft[field]) || (field === "phone" && baseline.dial !== draft.dial));
}
/** Updating a phone always includes its dial; collection edits always replace the entire array. */
export function copyDraftField(target: CandidateEditDraft, source: CandidateEditDraft, field: CandidateEditField): CandidateEditDraft {
 return { ...target, [field]: source[field], ...(field === "phone" ? { dial: source.dial } : {}) };
}
export function originalEditValues(candidate: EditableOrgCandidate): CandidateEditValues | null {
 const original = candidate.original;
 if (!original) return null;
 return { full_name: original.full_name, email: original.contact.email, phone: original.contact.phone,
  location: locationValueToWrite(locationReadToValue(original.profile.location)), professional_title: original.professional_title,
  current_company: original.current_company, seniority: original.profile.seniority, years_of_experience: original.profile.years_of_experience,
  education: null, languages: original.profile.languages, skills: original.profile.skills,
  linkedin_url: original.linkedin_url, portfolio_url: original.portfolio_url };
}
export function prepareCandidateEdit(candidate: EditableOrgCandidate, draft: CandidateEditDraft, resets: readonly CandidateEditField[]) {
 const baseline = candidateEditValues(candidate);
 const changed = editedDraftFields(valuesToEditDraft(baseline), draft).filter(field => !resets.includes(field));
 const errors: Record<string, string> = {};
 const year = (value: string) => value.trim() === "" ? null : /^\d+$/.test(value.trim()) ? Number(value) : NaN;
 const text = (value: string) => value.trim() || null;
 const raw = {
  ...draft, full_name: text(draft.full_name), email: text(draft.email), phone: phoneValue(draft.dial, draft.phone), location: locationValueToWrite(draft.location),
  professional_title: text(draft.professional_title), current_company: text(draft.current_company), seniority: text(draft.seniority), years_of_experience: text(draft.years_of_experience),
  skills: parseSkills(draft.skills),
  linkedin_url: text(draft.linkedin_url), portfolio_url: text(draft.portfolio_url),
  education: draft.education.map(row => ({ ...row, institution: text(row.institution), field: text(row.field), start_year: year(row.start_year), end_year: year(row.end_year) })),
 };
 const next = { ...baseline };
 for (const field of changed) {
  const value = raw[field];
  const parsed = candidateEditValuesSchema.shape[field].safeParse(value);
  if (!parsed.success) for (const issue of parsed.error.issues) errors[[field, ...issue.path].join(".")] ??= issue.code === "custom" ? issue.message : "Revisa este dato.";
  else Object.assign(next, { [field]: parsed.data });
 }
 if (changed.includes("full_name") && !raw.full_name) errors.full_name = "Escribe el nombre completo.";
 if (changed.includes("phone") && draft.phone.trim() && !raw.phone) errors.phone = phoneError(draft.dial);
 if (changed.includes("location") && draft.location.country === "MX") {
  if (!draft.location.state) errors["location.state"] = "Elige un estado.";
  if (!draft.location.municipality) errors["location.municipality"] = "Elige un municipio.";
 }
 const original = originalEditValues(candidate);
 const effectiveEmail = resets.includes("email") ? original?.email : next.email;
 const effectivePhone = resets.includes("phone") ? original?.phone : next.phone;
 if (!effectiveEmail && !effectivePhone) errors.contact = "Agrega un correo o un teléfono.";
 return { body: buildCandidateEditBody(candidate.kind, baseline, next, resets), errors };
}
export function educationSummary(profile: EditableOrgCandidate["profile"]) {
 return [profile.education.highest_completed && EDUCATION_LEVEL_LABELS[profile.education.highest_completed], profile.education.in_progress && `${EDUCATION_LEVEL_LABELS[profile.education.in_progress]} en curso`].filter(Boolean).join(" · ") || "Sin especificar";
}
/** Human-readable references, not raw JSON (which would expose API names to recruiters). */
export function editValueLabel(field: CandidateEditField, value: CandidateEditValues[CandidateEditField]): string {
 if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "Sin especificar";
 if (field === "seniority" && typeof value === "string" && value in SENIORITY_LABELS) return SENIORITY_LABELS[value as keyof typeof SENIORITY_LABELS];
 if (typeof value === "string") return value;
 if (Array.isArray(value)) return value.map(row => {
  if (typeof row === "string") return row;
  if ("code" in row) return `${row.code} · ${CEFR_LEVEL_LABELS[row.level]}`;
  return [EDUCATION_LEVEL_LABELS[row.level], EDUCATION_STATUS_LABELS[row.status], row.institution, row.field, [row.start_year, row.end_year].filter(year => year !== null).join("–")].filter(Boolean).join(" · ");
 }).join("; ");
 return [value.country, value.state, value.municipality, value.postal_code].filter(Boolean).join(" · ");
}
