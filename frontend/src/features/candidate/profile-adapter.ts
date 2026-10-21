import type { CandidateProfile } from "./model";
import type { EditedProfile } from "./profile-draft";
import type { ProfileLanguages, ProfileRead, ProfileWrite } from "./profile-api";

export function profileFromWire(p: ProfileRead, languages: ProfileLanguages): CandidateProfile {
  return {
    phone: p.phone ?? null, linkedinUrl: p.linkedin_url ?? null, portfolioUrl: p.portfolio_url ?? null,
    professionalTitle: p.professional_title ?? null, currentCompany: p.current_company ?? null,
    yearsOfExperience: p.years_of_experience ?? null, summary: p.profile_summary ?? null,
    birthDate: p.birth_date ?? null, location: p.location,
    seniority: p.seniority ?? null, education: p.education ?? [], skills: p.skills ?? [],
    currentSalaryGross: p.current_salary_gross ?? null, currentSalaryNet: p.current_salary_net ?? null,
    expectedSalary: p.expected_salary ?? null, salaryCurrency: p.salary_currency,
    expectedSalaryPeriod: p.expected_salary_period ?? null, languages: languages.languages,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}
/** A changed profile is always a FULL replacement, including explicit nulls.
 * Languages have their own endpoint and never enter this body. */
export function profileToWrite(p: EditedProfile): ProfileWrite {
  return {
    phone: p.phone, linkedin_url: p.linkedinUrl, portfolio_url: p.portfolioUrl,
    professional_title: p.professionalTitle, current_company: p.currentCompany,
    years_of_experience: p.yearsOfExperience, profile_summary: p.summary,
    birth_date: p.birthDate, location: p.location,
    seniority: p.seniority, education: p.education, skills: p.skills,
    current_salary_gross: p.currentSalaryGross, current_salary_net: p.currentSalaryNet,
    expected_salary: p.expectedSalary, salary_currency: p.salaryCurrency,
    expected_salary_period: p.expectedSalaryPeriod,
  };
}
