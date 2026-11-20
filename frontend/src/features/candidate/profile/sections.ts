import type { CandidateProfileDraft } from "../profile-draft";
import type { ProfileCategory } from "../profile-form-fields";

/** The five tabs of `/candidato/perfil` (artboard 01), in order; each edits one form category. */
export const PROFILE_TABS: readonly { key: ProfileCategory; title: string }[] = [
  { key: "personal", title: "Personal" },
  { key: "experience", title: "Experiencia" },
  { key: "education", title: "Educación" },
  { key: "compensation", title: "Compensación" },
  { key: "languages", title: "Idiomas" },
];
/** The draft keys each tab owns: what «Descartar cambios» restores and what puts the dot on the tab. */
export const TAB_DRAFT_KEYS: Readonly<Record<ProfileCategory, readonly (keyof CandidateProfileDraft)[]>> = {
  personal: ["dial", "phone", "linkedinUrl", "portfolioUrl", "location"],
  experience: ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"],
  education: ["education", "skills"],
  compensation: ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"],
  languages: ["languages"],
};
export const tabTitle = (key: ProfileCategory) => PROFILE_TABS.find(tab => tab.key === key)!.title;

/** The tab that owns a draft or issue path such as `education.0.level` or `location.state`. */
export function categoryOf(path: string): ProfileCategory {
  const root = path.split(".")[0] as keyof CandidateProfileDraft;
  return (Object.keys(TAB_DRAFT_KEYS) as ProfileCategory[]).find(key => TAB_DRAFT_KEYS[key].includes(root)) ?? "experience";
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function changedTabs(draft: CandidateProfileDraft, base: CandidateProfileDraft): ProfileCategory[] {
  return PROFILE_TABS.filter(({ key }) => TAB_DRAFT_KEYS[key].some(field => !same(draft[field], base[field]))).map(({ key }) => key);
}
/** The draft with one tab's keys put back to the confirmed baseline. */
export function discardTab(draft: CandidateProfileDraft, base: CandidateProfileDraft, key: ProfileCategory): CandidateProfileDraft {
  return { ...draft, ...Object.fromEntries(TAB_DRAFT_KEYS[key].map(field => [field, base[field]])) };
}
/** «a», «a y b», «a, b y c». */
export function listText(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}
