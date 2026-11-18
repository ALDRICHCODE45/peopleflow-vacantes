import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, EDUCATION_STATUS_LABELS, type EducationLevel } from "../model";
import type { CandidateProfileDraft, EducationDraft } from "../profile-draft";

/** Read-only formatting of the live draft, as the candidate and a company read it (artboard 04). */
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

export function phoneText(draft: CandidateProfileDraft): string {
  const phone = draft.phone.trim();
  if (!phone) return "";
  const digits = phone.replace(/\D/gu, "");
  if (draft.dial === "+52" && digits.length === 10 && /^[\d\s]+$/u.test(phone)) return `+52 ${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
  // A legacy free-text phone is shown verbatim until the candidate corrects it.
  return /^[\d\s]+$/u.test(phone) ? `${draft.dial} ${phone}` : phone;
}
/** «18 de junio de 1994» from an ISO date, with no time zone shift. */
export function dateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso.trim());
  return match ? `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1]} de ${match[1]}` : "";
}
/** «12 de noviembre de 2026» from a server timestamp, in local time. */
export function updatedText(timestamp: string | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}
export function yearsText(value: string): string {
  const years = value.trim();
  return years ? `${years.replace(".", ",")} ${years === "1" ? "año" : "años"}` : "";
}
export function moneyText(value: string, currency: string): string {
  const amount = value.trim();
  if (!/^\d+$/u.test(amount)) return amount;
  return `$${number.format(Number(amount))} ${currency.trim().toUpperCase()}`.trim();
}
export const skillList = (skills: string) => skills.split(/[,\n]/u).map(skill => skill.trim()).filter(Boolean);
export const urlText = (url: string) => url.trim().replace(/^https?:\/\/(www\.)?/u, "").replace(/\/$/u, "");

/** The highest education level of all studies: the only education fact a company receives. */
export function highestLevel(education: readonly EducationDraft[]): EducationLevel | null {
  const levels = education.map(study => study.level).filter((level): level is EducationLevel => level !== "");
  return levels.length ? levels.reduce((top, level) => EDUCATION_LEVELS.indexOf(level) > EDUCATION_LEVELS.indexOf(top) ? level : top) : null;
}
export const levelText = (level: EducationLevel | "") => level ? EDUCATION_LEVEL_LABELS[level] : "";
export function studyDetails(study: EducationDraft): string {
  const years = study.status === "in_progress" ? `${study.start_year || "—"} – en curso` : [study.start_year, study.end_year].filter(Boolean).join(" – ");
  const status = study.status && study.status !== "in_progress" ? EDUCATION_STATUS_LABELS[study.status] : "";
  return [study.field.trim(), study.institution.trim(), years, status].filter(Boolean).join(" · ");
}
