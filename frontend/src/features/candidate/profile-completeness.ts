import type { CandidateProfile } from "./model";
import { profileToDraft, type CandidateProfileDraft } from "./profile-draft";

/**
 * The ten key data points of a candidate profile (L22 «10 datos en los dos lados»): the ONE definition read by the
 * profile editor (`/candidato/perfil`, live draft) and by the dashboard (Perfil tile and «Siguiente paso», saved
 * profile through `profileToDraft`). LinkedIn, portfolio and seniority are optional and never count. Zero years or a
 * zero salary are valid filled values. `key` is the editor path that receives focus when the item is missing.
 */
export const KEY_DATA = [
  { key: "professionalTitle", label: "título profesional", done: (d: CandidateProfileDraft) => d.professionalTitle.trim() !== "" },
  { key: "currentCompany", label: "empresa actual", done: (d: CandidateProfileDraft) => d.currentCompany.trim() !== "" },
  { key: "yearsOfExperience", label: "años de experiencia", done: (d: CandidateProfileDraft) => d.yearsOfExperience.trim() !== "" },
  { key: "summary", label: "resumen profesional", done: (d: CandidateProfileDraft) => d.summary.trim() !== "" },
  { key: "phone", label: "teléfono", done: (d: CandidateProfileDraft) => d.phone.trim() !== "" },
  { key: "location", label: "ubicación", done: (d: CandidateProfileDraft) => d.location.country !== null },
  { key: "education", label: "estudios", done: (d: CandidateProfileDraft) => d.education.some(study => study.level && study.status) },
  { key: "skills", label: "habilidades", done: (d: CandidateProfileDraft) => d.skills.trim() !== "" },
  { key: "expectedSalary", label: "salario esperado", done: (d: CandidateProfileDraft) => d.expectedSalary.trim() !== "" },
  { key: "languages", label: "idiomas", done: (d: CandidateProfileDraft) => d.languages.some(row => row.code && row.level) },
] as const;
export type KeyDataKey = (typeof KEY_DATA)[number]["key"];
export type Completeness = {
  completed: number; total: number; percentage: number; missing: string[];
  items: { key: KeyDataKey; label: string; done: boolean }[];
};

export function draftCompleteness(draft: CandidateProfileDraft | null): Completeness {
  const items = KEY_DATA.map(({ key, label, done }) => ({ key, label, done: draft !== null && done(draft) }));
  const missing = items.filter(item => !item.done).map(item => item.label);
  const total = items.length, completed = total - missing.length;
  return { completed, total, percentage: Math.round(completed / total * 100), missing, items };
}
/** A saved profile scored with the same ten points as the editor. */
export function profileCompleteness(profile: CandidateProfile | null): Completeness {
  return draftCompleteness(profile ? profileToDraft(profile) : null);
}
export function missingProfileText(missing: readonly string[]) {
  return missing.length < 2 ? missing.join("") : `${missing.slice(0, -1).join(", ")} y ${missing.at(-1)}`;
}
