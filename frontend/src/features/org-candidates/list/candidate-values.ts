import type { LanguageCatalog } from "@/features/languages/model";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import type { OrgCandidate } from "../model";
import { relativeTime } from "../relative-time";

// The list contract does not yet include corrections. Confirmed sheet edits can
// enrich their own row without fetching every candidate's detail just for a badge.
export type CandidateListItem = OrgCandidate & { corrected_fields?: readonly string[] };
export const candidateKey = (item: OrgCandidate) => `${item.kind}:${item.id}`;
export const candidateDateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
export const originLabel = (item: OrgCandidate) => item.kind === "manual" ? "Manual" : "Orgánico";
export function locationLines(item: OrgCandidate) {
 const location = item.profile.location;
 const primary = location?.municipality?.name || location?.state?.name || location?.country?.name || location?.label;
 const secondary = [location?.municipality && location.state?.name, (location?.municipality || location?.state) && location?.country?.name].filter(Boolean).join(", ");
 return { primary: primary || "Sin dato", secondary: secondary || undefined, missing: !primary };
}
export function experienceLines(item: OrgCandidate) {
 const { years_of_experience: years, seniority } = item.profile;
 return { primary: years !== null ? `${years} ${Number(years) === 1 ? "año" : "años"}` : "Sin dato", secondary: seniority ? SENIORITY_LABELS[seniority] : undefined, missing: years === null };
}
export function educationLines(item: OrgCandidate) {
 const { highest_completed: completed, in_progress: progress } = item.profile.education;
 return { primary: completed ? educationLabels[completed] : progress ? educationLabels[progress] : "Sin dato", secondary: progress ? `${completed ? `${educationLabels[progress]} · ` : ""}En curso` : completed ? "Concluida" : undefined, missing: !completed && !progress };
}
export function languageLabels(item: OrgCandidate, languages: LanguageCatalog["items"]) {
 return item.profile.languages.map(language => `${languages.find(entry => entry.code === language.code)?.name ?? "Idioma no disponible"} ${language.level === "native" ? "Nativo" : language.level}`);
}
type VacancyBadge = { text: string; variant: "danger" | "neutral" | "review" | "info" | "success" };
export function vacancyBadges(item: OrgCandidate): VacancyBadge[] {
 const latest = item.latest_participation;
 if (!latest) return [];
 // Stage ids are opaque UUIDs; reinforce recognized labels without inventing state.
 const name = latest.stage.name.trim().toLocaleLowerCase("es-MX");
 const badges: VacancyBadge[] = [{ text: latest.stage.name.trim(), variant: name === "placement" || name === "screening ok" ? "success" : name === "en proceso" ? "review" : name === "nuevos" ? "neutral" : "info" }];
 // Lifecycle and candidate outcome are independent; neither hides the other.
 if (latest.vacancy.lifecycle.publication === "paused") badges.push({ text: "Pausada", variant: "review" });
 if (latest.vacancy.lifecycle.publication === "closed") badges.push({ text: "Cerrada", variant: "neutral" });
 if (latest.vacancy.lifecycle.process === "finished") badges.push({ text: "Proceso finalizado", variant: "neutral" });
 if (latest.state === "discarded") badges.push({ text: "Descartado", variant: "danger" });
 return badges;
}
export const processLabels = (item: OrgCandidate) => ({ total: `${item.participations.total} ${item.participations.total === 1 ? "proceso" : "procesos"}`, active: `${item.participations.active} ${item.participations.active === 1 ? "activo" : "activos"}` });
const join = (...values: (string | undefined | null)[]) => values.filter(Boolean).join(" · ");
/** Plain, complete values: never DOM text, clipped text, icons or action labels. */
export function candidatePlainValue(item: OrgCandidate, column: string, languages: LanguageCatalog["items"]) {
 switch (column) {
  case "candidate": return join(item.full_name, normalizedProfileLabel(item.professional_title ?? ""), originLabel(item));
  case "location": { const value = locationLines(item); return join(value.primary, value.secondary); }
  case "experience": { const value = experienceLines(item); return join(value.primary, value.secondary); }
  case "education": { const value = educationLines(item); return join(value.primary, value.secondary); }
  case "languages": return languageLabels(item, languages).join("; ") || "Sin dato";
  case "vacancy": return item.latest_participation ? join(item.latest_participation.vacancy.title, ...vacancyBadges(item).map(badge => badge.text)) : "Sin participaciones";
  case "processes": { const value = processLabels(item); return join(value.total, value.active); }
  case "activity": return join(candidateDateFormat.format(new Date(item.last_activity_at)), relativeTime(item.last_activity_at));
  default: return "";
 }
}
