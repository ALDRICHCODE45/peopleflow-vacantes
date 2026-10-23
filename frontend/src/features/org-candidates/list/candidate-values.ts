import type { LanguageCatalog } from "@/features/languages/model";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import type { OrgCandidate } from "../model";
import type { CandidateContact } from "../contacts/contacts-model";

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
const exportDateFormat = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Mexico_City" });
/** CSV groups expand into single-value cells, independently of display hierarchy. */
export function candidateExportValues(item: OrgCandidate, languages: LanguageCatalog["items"], contact?: CandidateContact): Record<string, string[]> {
 const { location, years_of_experience: years, seniority, education } = item.profile;
 const latest = item.latest_participation;
 const publication = latest?.vacancy.lifecycle.publication;
 const process = latest?.vacancy.lifecycle.process;
 const dateParts = exportDateFormat.formatToParts(new Date(item.last_activity_at));
 const date = ["year", "month", "day"].map(part => dateParts.find(value => value.type === part)?.value).join("-");
 const contacts = [contact?.email ?? "", contact?.phone ?? ""];
 return {
  contact: contacts,
  candidate: [item.full_name, normalizedProfileLabel(item.professional_title ?? ""), originLabel(item), ...contacts],
  location: [location?.municipality?.name ?? "", location?.state?.name ?? "", location?.country?.name ?? ""],
  experience: [years ?? "", seniority ? SENIORITY_LABELS[seniority] : ""],
  education: [education.highest_completed ? educationLabels[education.highest_completed] : "", education.in_progress ? educationLabels[education.in_progress] : ""],
  languages: [languageLabels(item, languages).join("; ")],
  vacancy: latest ? [latest.vacancy.title, latest.stage.name.trim(), latest.state === "discarded" ? "Descartado" : "Activo",
   publication === "published" ? "Publicada" : publication === "paused" ? "Pausada" : publication === "closed" ? "Cerrada" : "Sin publicar",
   process === "active" ? "Activo" : process === "finished" ? "Finalizado" : ""] : ["", "", "", "", ""],
  processes: [String(item.participations.total), String(item.participations.active)],
  activity: [date],
 };
}
