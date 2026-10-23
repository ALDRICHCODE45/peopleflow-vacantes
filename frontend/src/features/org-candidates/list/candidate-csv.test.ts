import { expect, it } from "vitest";
import { candidateCsv } from "./candidate-csv";
import { candidate } from "./test-fixtures";
const languages = [{ code: "en", name: "Inglés" }, { code: "es", name: "Español" }];
it("exports complete values in visual column order, excluding selection/actions and hidden columns", () => {
 const csv = candidateCsv([candidate], ["selection", "activity", "candidate", "languages", "actions"], languages);
 expect(csv).toMatch(/^\uFEFF"Actividad","Candidato","Idiomas"\r\n/u);
 expect(csv).toContain(candidate.full_name); expect(csv).toContain("Desarrolladora Frontend · Manual");
 expect(csv).not.toContain("Ubicación"); expect(csv).not.toContain("Backend Go"); expect(csv).not.toContain("Acciones");
});
it("keeps non-ASCII names, commas, quotes and embedded line breaks", () => {
 const csv = candidateCsv([{ ...candidate, full_name: 'María, "Ángeles"\nLópez' }], ["candidate"], languages);
 expect(csv).toContain('"María, ""Ángeles""\nLópez · Desarrolladora Frontend · Manual"');
});
it.each(["=HYPERLINK(1)", "+SUM(1)", "-1+2", "@SUM(1)", " \t=1+1"])("neutralizes spreadsheet formulas: %s", full_name => {
 expect(candidateCsv([{ ...candidate, full_name }], ["candidate"], languages)).toContain(`"'${full_name}`);
});
it("exports all languages instead of the clipped first-language chip and +N", () => {
 const csv = candidateCsv([{ ...candidate, profile: { ...candidate.profile, languages: [{ code: "en", level: "C1" }, { code: "es", level: "native" }] } }], ["languages"], languages);
 expect(csv).toContain('"Inglés C1; Español Nativo"'); expect(csv).not.toContain("+1");
});
it("retains independent vacancy lifecycle and candidate outcome", () => {
 const csv = candidateCsv([{ ...candidate, latest_participation: { ...candidate.latest_participation, state: "discarded", vacancy: { ...candidate.latest_participation.vacancy, lifecycle: { publication: "closed", process: "finished" } } } }], ["vacancy"], languages);
 for (const value of ["Backend Go", "Entrevista", "Cerrada", "Proceso finalizado", "Descartado"]) expect(csv).toContain(value);
});
it("uses honest missing values for absent profiles and participation", () => {
 const csv = candidateCsv([{ ...candidate, latest_participation: null, profile: { location: null, seniority: null, years_of_experience: null, skills: [], education: { highest_completed: null, in_progress: null }, languages: [] } }], ["location", "experience", "education", "languages", "vacancy"], []);
 expect(csv).toContain('"Sin dato","Sin dato","Sin dato","Sin dato","Sin participaciones"');
});
