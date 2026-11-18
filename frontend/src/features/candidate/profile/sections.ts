import type { CandidateProfileDraft } from "../profile-draft";
import type { ProfileCategory } from "../profile-form-fields";

/** The five sections of `/candidato/perfil` (artboard 04), in reading order; each edits one form category. */
export const PROFILE_SECTIONS: readonly { key: ProfileCategory; title: string }[] = [
  { key: "experience", title: "Experiencia" },
  { key: "education", title: "Educación y habilidades" },
  { key: "languages", title: "Idiomas" },
  { key: "personal", title: "Contacto y ubicación" },
  { key: "compensation", title: "Compensación" },
];
/** The draft keys each section owns: what «Descartar cambios de …» restores and what marks it changed. */
export const SECTION_DRAFT_KEYS: Readonly<Record<ProfileCategory, readonly (keyof CandidateProfileDraft)[]>> = {
  personal: ["dial", "phone", "birthDate", "linkedinUrl", "portfolioUrl", "location"],
  experience: ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"],
  education: ["education", "skills"],
  compensation: ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"],
  languages: ["languages"],
};
export const sectionTitle = (key: ProfileCategory) => PROFILE_SECTIONS.find(section => section.key === key)!.title;

/** The section that owns a draft or issue path such as `education.0.level` or `location.state`. */
export function categoryOf(path: string): ProfileCategory {
  const root = path.split(".")[0] as keyof CandidateProfileDraft;
  return (Object.keys(SECTION_DRAFT_KEYS) as ProfileCategory[]).find(key => SECTION_DRAFT_KEYS[key].includes(root)) ?? "experience";
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function changedSections(draft: CandidateProfileDraft, base: CandidateProfileDraft): ProfileCategory[] {
  return PROFILE_SECTIONS.filter(({ key }) => SECTION_DRAFT_KEYS[key].some(field => !same(draft[field], base[field]))).map(({ key }) => key);
}
/** The draft with one section's keys put back to the confirmed baseline. */
export function discardSection(draft: CandidateProfileDraft, base: CandidateProfileDraft, key: ProfileCategory): CandidateProfileDraft {
  return { ...draft, ...Object.fromEntries(SECTION_DRAFT_KEYS[key].map(field => [field, base[field]])) };
}
