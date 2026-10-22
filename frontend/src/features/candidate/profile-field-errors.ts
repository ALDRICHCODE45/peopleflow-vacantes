import type { ProfileDraftIssue } from "./profile-draft";
import { phoneError } from "@/lib/phone";
import type { ProfileFailure } from "./profile-api";
const wireNames: Record<string, string> = { linkedin_url: "linkedinUrl", portfolio_url: "portfolioUrl", professional_title: "professionalTitle", current_company: "currentCompany", years_of_experience: "yearsOfExperience", profile_summary: "summary", birth_date: "birthDate", current_salary_gross: "currentSalaryGross", current_salary_net: "currentSalaryNet", expected_salary: "expectedSalary", salary_currency: "salaryCurrency", expected_salary_period: "expectedSalaryPeriod" };
const order = ["phone", "birthDate", "linkedinUrl", "portfolioUrl", "location", "professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary", "education", "skills", "currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod", "languages"];
const nestedOrder = ["level", "institution", "field", "status", "start_year", "end_year"];
export function sortProfileIssues(issues: readonly ProfileDraftIssue[]): ProfileDraftIssue[] {
  return [...issues].sort((a, b) => {
    const [ar, ai, af] = a.path.split("."); const [br, bi, bf] = b.path.split(".");
    const byGroup = order.indexOf(ar) - order.indexOf(br);
    if (byGroup) return byGroup;
    if (ar === "location") return ["country", "state", "municipality"].indexOf(ai) - ["country", "state", "municipality"].indexOf(bi);
    return Number(ai ?? 0) - Number(bi ?? 0) || (ar === "education" ? nestedOrder.indexOf(af) - nestedOrder.indexOf(bf) : a.path.localeCompare(b.path));
  });
}
export function profileFieldIssues(fields: NonNullable<ProfileFailure["fields"]>, dial = "+52"): ProfileDraftIssue[] {
  const messages = { required: "Completa este dato.", invalid: "Revisa este dato.", too_long: "El texto es demasiado largo.", not_allowed: "Este dato no está permitido.", duplicate: "Este idioma ya está agregado." };
  return fields.flatMap(issue => {
    const path = issue.field.replace(/\[(\d+)\]/g, ".$1");
    const mapped = wireNames[path] ?? path;
    // Never interpolate unrecognized server paths into DOM selectors.
    return order.includes(mapped) || /^education\.\d+\.(level|institution|field|status|start_year|end_year)$/.test(mapped) || /^languages\.\d+\.(code|level)$/.test(mapped)
      ? [{ path: mapped, message: mapped === "phone" && issue.code === "invalid" ? phoneError(dial) : messages[issue.code] }] : [];
  });
}
