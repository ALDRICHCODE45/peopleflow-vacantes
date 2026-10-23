import type { OrgCandidate } from "../model";
import type { LanguageCatalog } from "@/features/languages/model";
import { candidatePlainValue } from "./candidate-values";
const exportLabels: Record<string, string> = { candidate: "Candidato", location: "Ubicación", experience: "Experiencia", education: "Estudios", languages: "Idiomas", vacancy: "Última vacante", processes: "Procesos", activity: "Actividad" };
function csvCell(value: string) {
 // CSV quoting alone does not stop spreadsheet formula execution.
 const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value;
 return `"${safe.replaceAll('"', '""')}"`;
}
export function candidateCsv(items: OrgCandidate[], visibleColumns: string[], languages: LanguageCatalog["items"]) {
 const columns = visibleColumns.filter(id => Object.hasOwn(exportLabels, id));
 return "\uFEFF" + [columns.map(id => exportLabels[id]), ...items.map(item => columns.map(id => candidatePlainValue(item, id, languages)))].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function downloadCandidateCsv(items: OrgCandidate[], visibleColumns: string[], languages: LanguageCatalog["items"], now = new Date()) {
 const csv = candidateCsv(items, visibleColumns, languages);
 const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
 const link = document.createElement("a");
 link.href = url;
 link.download = `candidatos-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;
 document.body.append(link);
 try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
