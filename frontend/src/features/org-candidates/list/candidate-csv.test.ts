import { expect, it } from "vitest";
import { candidateCsv } from "./candidate-csv";
import { candidate } from "./test-fixtures";
const languages = [{ code: "en", name: "Inglés" }, { code: "es", name: "Español" }];
const contacts = [{ kind: candidate.kind, id: candidate.id, email: "mariana@example.test", phone: "+525555555555" }];
it("exports the exact C4 single-value columns in visual order, with contact and Mexico City date", () => {
 const item = { ...candidate, last_activity_at: "2026-10-22T01:00:00Z", profile: { ...candidate.profile, languages: [{ code: "en", level: "C1" as const }, { code: "es", level: "native" as const }] } };
 expect(candidateCsv([item], ["selection", "candidate", "location", "experience", "education", "languages", "vacancy", "processes", "activity", "actions"], languages, contacts)).toBe(
  '\uFEFF"Nombre","Puesto","Origen","Email","Teléfono","Municipio","Estado","País","Años de experiencia","Seniority","Estudios concluidos","Estudios en curso","Idiomas","Última vacante","Etapa","Estado en la vacante","Publicación","Proceso de la vacante","Procesos","Procesos activos","Última actividad"\r\n' +
  '"Mariana Ortega Silva","Desarrolladora Frontend","Manual","mariana@example.test","\'+525555555555","Guadalajara","Jalisco","México","4.5","Senior","Licenciatura o Ingeniería","Maestría","Inglés C1; Español Nativo","Backend Go","Entrevista","Activo","Publicada","Activo","2","1","2026-10-21"\r\n');
});
it("keeps contacts first when candidate is hidden and respects reordered visible groups", () => {
 expect(candidateCsv([candidate], ["activity", "experience", "actions"], languages, contacts)).toBe(
  '\uFEFF"Email","Teléfono","Última actividad","Años de experiencia","Seniority"\r\n"mariana@example.test","\'+525555555555","2026-10-21","4.5","Senior"\r\n');
});
it("uses empty cells for missing data and omitted contacts, retaining integer zeros", () => {
 const item = { ...candidate, professional_title: null, latest_participation: null, participations: { total: 0, active: 0 }, profile: { location: null, seniority: null, years_of_experience: null, skills: [], education: { highest_completed: null, in_progress: null }, languages: [] } };
 expect(candidateCsv([item], ["candidate", "location", "experience", "education", "languages", "vacancy", "processes"], [], [])).toBe(
  '\uFEFF"Nombre","Puesto","Origen","Email","Teléfono","Municipio","Estado","País","Años de experiencia","Seniority","Estudios concluidos","Estudios en curso","Idiomas","Última vacante","Etapa","Estado en la vacante","Publicación","Proceso de la vacante","Procesos","Procesos activos"\r\n' +
  '"Mariana Ortega Silva","","Manual","","","","","","","","","","","","","","","","0","0"\r\n');
});
it("keeps non-ASCII names, commas, quotes and embedded line breaks", () => {
 expect(candidateCsv([{ ...candidate, full_name: 'María, "Ángeles"\nLópez' }], ["candidate"], languages, [])).toBe(
  '\uFEFF"Nombre","Puesto","Origen","Email","Teléfono"\r\n"María, ""Ángeles""\nLópez","Desarrolladora Frontend","Manual","",""\r\n');
});
it.each(["=HYPERLINK(1)", "+SUM(1)", "-1+2", "@SUM(1)", " \t=1+1"])("neutralizes spreadsheet formulas in names and contacts: %s", value => {
 const csv = candidateCsv([{ ...candidate, full_name: value }], ["candidate"], languages, [{ ...contacts[0], email: value, phone: value }]);
 expect(csv.split("\r\n")[1]).toBe(`"'${value}","Desarrolladora Frontend","Manual","'${value}","'${value}"`);
});
it.each([
 ["published", "active", "active", "Publicada", "Activo", "Activo"],
 ["paused", "active", "discarded", "Pausada", "Activo", "Descartado"],
 ["closed", "finished", "discarded", "Cerrada", "Finalizado", "Descartado"],
 [null, null, "active", "Sin publicar", "", "Activo"],
] as const)("exports independent vacancy states %s/%s/%s", (publication, process, state, publicationLabel, processLabel, stateLabel) => {
 const item = { ...candidate, latest_participation: { ...candidate.latest_participation, state, vacancy: { ...candidate.latest_participation.vacancy, lifecycle: { publication, process } } } };
 expect(candidateCsv([item], ["vacancy"], languages, [])).toBe(
  '\uFEFF"Email","Teléfono","Última vacante","Etapa","Estado en la vacante","Publicación","Proceso de la vacante"\r\n' +
  `"","","Backend Go","Entrevista","${stateLabel}","${publicationLabel}","${processLabel}"\r\n`);
});
