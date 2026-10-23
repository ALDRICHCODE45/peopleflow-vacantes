import type { OrgCandidate } from "../model";
import type { LanguageCatalog } from "@/features/languages/model";
import { candidateExportValues } from "./candidate-values";
import { contactIdentityKey, type CandidateContact } from "../contacts/contacts-model";
const exportLabels: Record<string, string[]> = {
 contact: ["Email", "Teléfono"], candidate: ["Nombre", "Puesto", "Origen", "Email", "Teléfono"],
 location: ["Municipio", "Estado", "País"], experience: ["Años de experiencia", "Seniority"],
 education: ["Estudios concluidos", "Estudios en curso"], languages: ["Idiomas"],
 vacancy: ["Última vacante", "Etapa", "Estado en la vacante", "Publicación", "Proceso de la vacante"],
 processes: ["Procesos", "Procesos activos"], activity: ["Última actividad"],
};
function csvCell(value: string) {
 // CSV quoting alone does not stop spreadsheet formula execution.
 const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value;
 return `"${safe.replaceAll('"', '""')}"`;
}
export function candidateCsv(items: OrgCandidate[], visibleColumns: string[], languages: LanguageCatalog["items"], contacts: CandidateContact[]) {
 const columns = visibleColumns.filter(id => id !== "contact" && Object.hasOwn(exportLabels, id));
 if (!columns.includes("candidate")) columns.unshift("contact");
 const byIdentity = new Map(contacts.map(item => [contactIdentityKey(item), item]));
 const rows = items.map(item => {
  const values = candidateExportValues(item, languages, byIdentity.get(contactIdentityKey(item)));
  return columns.flatMap(id => values[id]);
 });
 return "\uFEFF" + [columns.flatMap(id => exportLabels[id]), ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function downloadCandidateCsv(items: OrgCandidate[], visibleColumns: string[], languages: LanguageCatalog["items"], contacts: CandidateContact[], now = new Date()) {
 const csv = candidateCsv(items, visibleColumns, languages, contacts);
 const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
 const link = document.createElement("a");
 link.href = url;
 link.download = `candidatos-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;
 document.body.append(link);
 try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
