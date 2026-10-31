import type { CandidateProfile } from "./model";

/** Existing dashboard checklist, shared by the real-data dashboard after wire
 * normalization. Links, salary and experience are optional profile guidance,
 * not requirements to apply. Zero salary/experience are valid filled values. */
const checks: readonly (readonly [string, (profile: CandidateProfile) => boolean])[] = [
  ["título profesional", p => !!p.professionalTitle?.trim()],
  ["resumen profesional", p => !!p.summary?.trim()],
  ["teléfono", p => !!p.phone?.trim()],
  ["ubicación", p => p.location !== null],
  ["estudios", p => p.education.length > 0],
  ["nivel de experiencia", p => p.seniority !== null],
  ["años de experiencia", p => p.yearsOfExperience !== null],
  ["habilidades", p => p.skills.length > 0],
  ["idiomas", p => p.languages.length > 0],
  ["LinkedIn", p => !!p.linkedinUrl?.trim()],
  ["portafolio", p => !!p.portfolioUrl?.trim()],
  ["expectativa salarial", p => p.expectedSalary !== null],
];
export function profileCompleteness(profile: CandidateProfile | null) {
  const missing = checks.filter(([, filled]) => !profile || !filled(profile)).map(([label]) => label);
  const total = checks.length, completed = total - missing.length;
  return { completed, total, percentage: Math.round(completed / total * 100), missing };
}
export function missingProfileText(missing: readonly string[]) {
  return missing.length < 2 ? missing.join("") : `${missing.slice(0, -1).join(", ")} y ${missing.at(-1)}`;
}
