import { fitLine } from "../board/fit";
import { resultLabel } from "../evaluate";
import type { Comparison, StageNames } from "./model";
// Same protection as org-candidates/list/candidate-csv: quoting alone is insufficient.
function csvCell(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function comparisonCsv(model: Comparison, title: string, company: string, date: string, stages: StageNames = {}) {
  const rows = [["Vacante", title], ["Empresa", company], ["Fecha", date],
    ["Candidato", "Etapa", "Ajuste", "Importancia", "Criterio", "Resultado", "Fuente", "Nota del reclutador"]];
  model.candidates.forEach((candidate, index) => model.groups.forEach(group => group.rows.forEach(row => {
    const cell = row.cells[index];
    rows.push([candidate.name, stages[candidate.stageId] ?? "Etapa no disponible", fitLine(candidate.summary), group.label, row.label, resultLabel(cell.result), cell.source ?? "", cell.note ?? ""]);
  })));
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function downloadComparisonCsv(model: Comparison, title: string, company: string, date: string, stages: StageNames) {
  const url = URL.createObjectURL(new Blob([comparisonCsv(model, title, company, date, stages)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "terna-peopleflow.csv";
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
