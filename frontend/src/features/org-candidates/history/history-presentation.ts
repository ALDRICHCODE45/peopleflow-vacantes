import { relativeTime } from "../relative-time";
import { EDUCATION_LEVEL_LABELS, EDUCATION_STATUS_LABELS, SENIORITY_LABELS } from "@/features/candidate/model";
import type { LanguageCatalog } from "@/features/languages/model";
import type { HistoryChange } from "./history-model";

const labels = {
  professional_title: "Título profesional", current_company: "Empresa actual", years_of_experience: "Años de experiencia",
  seniority: "Seniority", education: "Estudios", languages: "Idiomas", location: "Ubicación", skills: "Habilidades",
  linkedin_url: "LinkedIn", portfolio_url: "Portafolio",
} as const;
type ValueChange = Exclude<HistoryChange, { contact: true }>;
function formatValue(change: ValueChange, side: "from" | "to", languages: LanguageCatalog["items"]): string {
  if (change[side] === null) return "Sin dato";
  switch (change.field) {
    case "years_of_experience": return `${change[side]} ${Number(change[side]) === 1 ? "año" : "años"}`;
    case "seniority": return SENIORITY_LABELS[change[side]!];
    case "education": return change[side]!.map(study => `${EDUCATION_LEVEL_LABELS[study.level]} (${EDUCATION_STATUS_LABELS[study.status].toLocaleLowerCase("es-MX")})`).join(", ") || "Sin dato";
    case "languages": return change[side]!.map(language => `${languages.find(item => item.code === language.code)?.name ?? "Idioma no disponible"} ${language.level === "native" ? "Nativo" : language.level}`).join(", ") || "Sin dato";
    case "location": return [change[side]!.municipality?.name, change[side]!.state?.name, change[side]!.country.name].filter(Boolean).join(", ");
    case "skills": return change[side]!.join(", ") || "Sin dato";
    default: return change[side] || "Sin dato";
  }
}
export function historyChangeText(change: HistoryChange, languages: LanguageCatalog["items"]): string {
  // Branch on field before reading anything else: contact values must never reach any DOM/tooltip.
  if (change.field === "full_name") return "Nombre modificado";
  if (change.field === "email") return "Correo modificado";
  if (change.field === "phone") return "Teléfono modificado";
  const valueChange = change as ValueChange;
  const label = labels[valueChange.field];
  return "reset" in valueChange
    ? `${label}: se restauró el original (${formatValue(valueChange, "to", languages)})`
    : `${label}: ${formatValue(valueChange, "from", languages)} → ${formatValue(valueChange, "to", languages)}`;
}
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
export function historyDate(value: string) {
  const relative = relativeTime(value);
  return `${dateFormat.format(new Date(value))} · ${relative}`;
}
