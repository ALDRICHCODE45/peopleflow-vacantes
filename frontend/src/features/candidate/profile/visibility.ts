import type { ProfileCategory } from "../profile-form-fields";

/**
 * Who sees each profile fact: «company» (on the ficha a company receives when the candidate applies) or «private»
 * (only the candidate). Backend-confirmed: the company receives a copy taken when the candidate applies (the phone
 * stays live), plus the CV attached to that application; name and email come from the account. Every visibility
 * label, the ficha and the «Qué recibe la empresa» copy read this ONE map at render time.
 *
 * `professionalTitle` is pending a product decision: flip that single entry to move it in or out of the ficha.
 */
export type Audience = "company" | "private";
export const PROFILE_VISIBILITY = {
  fullName: "company",
  email: "company",
  phone: "company",
  location: "company",
  professionalTitle: "company",
  yearsOfExperience: "company",
  seniority: "company",
  /** Only the highest education level of all studies. */
  educationLevel: "company",
  skills: "company",
  languages: "company",
  linkedinUrl: "private",
  portfolioUrl: "private",
  currentCompany: "private",
  summary: "private",
  /** Institution, field, status and years of each study. */
  educationDetails: "private",
  currentSalaryGross: "private",
  currentSalaryNet: "private",
  expectedSalary: "private",
  expectedSalaryPeriod: "private",
  salaryCurrency: "private",
} satisfies Record<string, Audience> as Record<VisibilityField, Audience>;
export type VisibilityField =
  | "fullName" | "email" | "phone" | "location" | "professionalTitle" | "yearsOfExperience" | "seniority" | "educationLevel"
  | "skills" | "languages" | "linkedinUrl" | "portfolioUrl" | "currentCompany" | "summary" | "educationDetails"
  | "currentSalaryGross" | "currentSalaryNet" | "expectedSalary" | "expectedSalaryPeriod" | "salaryCurrency";

export const visibleToCompany = (field: VisibilityField): boolean => PROFILE_VISIBILITY[field] === "company";

/** The facts each section of `/candidato/perfil` shows, for its visibility tag. */
export const SECTION_FACTS: Readonly<Record<ProfileCategory, readonly VisibilityField[]>> = {
  experience: ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"],
  education: ["educationLevel", "educationDetails", "skills"],
  languages: ["languages"],
  personal: ["phone", "location", "email", "linkedinUrl", "portfolioUrl"],
  compensation: ["currentSalaryGross", "currentSalaryNet", "expectedSalary", "expectedSalaryPeriod", "salaryCurrency"],
};
export function sectionVisibility(section: ProfileCategory): Audience | "mixed" {
  const audiences = new Set(SECTION_FACTS[section].map(field => PROFILE_VISIBILITY[field]));
  return audiences.size === 1 ? [...audiences][0] : "mixed";
}

/** Copy for «Qué recibe la empresa»: how each fact reads in the company list and in the «Solo tú» list. */
const COPY: Readonly<Record<VisibilityField, { company: string; private: string }>> = {
  fullName: { company: "nombre", private: "tu nombre" },
  email: { company: "correo", private: "tu correo" },
  phone: { company: "teléfono", private: "tu teléfono" },
  location: { company: "ubicación", private: "tu ubicación" },
  professionalTitle: { company: "título profesional", private: "título profesional" },
  yearsOfExperience: { company: "años de experiencia", private: "años de experiencia" },
  seniority: { company: "seniority", private: "seniority" },
  educationLevel: { company: "tu nivel de estudios más alto", private: "tu nivel de estudios" },
  skills: { company: "habilidades", private: "habilidades" },
  languages: { company: "idiomas", private: "idiomas" },
  linkedinUrl: { company: "LinkedIn", private: "LinkedIn" },
  portfolioUrl: { company: "portafolio", private: "portafolio" },
  currentCompany: { company: "empresa actual", private: "empresa actual" },
  summary: { company: "resumen profesional", private: "resumen profesional" },
  educationDetails: { company: "detalles de tus estudios", private: "los detalles de tus estudios" },
  currentSalaryGross: { company: "compensación", private: "tu compensación" },
  currentSalaryNet: { company: "compensación", private: "tu compensación" },
  expectedSalary: { company: "compensación", private: "tu compensación" },
  expectedSalaryPeriod: { company: "compensación", private: "tu compensación" },
  salaryCurrency: { company: "compensación", private: "tu compensación" },
};
/** «a, b y c»; «e» before a word that sounds like «i» («habilidades e idiomas»). */
function list(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  const last = items.at(-1)!;
  return `${items.slice(0, -1).join(", ")} ${/^h?i(?![aeou])/iu.test(last) ? "e" : "y"} ${last}`;
}
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export function companyReceives(): { company: string; private: string } {
  const phrases = (audience: Audience) => [...new Set((Object.keys(PROFILE_VISIBILITY) as VisibilityField[])
    .filter(field => PROFILE_VISIBILITY[field] === audience).map(field => COPY[field][audience]))];
  const company = phrases("company"), mine = phrases("private");
  return {
    company: company.length ? `${capitalize(list(company))}.` : "",
    private: mine.length ? `Solo tú ves ${list(mine)}.` : "",
  };
}
