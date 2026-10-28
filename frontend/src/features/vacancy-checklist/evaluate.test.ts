import { expect, it } from "vitest";
import { evaluateCriterion, summarize, compareFit, resultLabel, sourceLabel, type EvaluationParticipation } from "@/features/vacancy-checklist/evaluate";
import { criterionSchema, type Mark } from "./model";
const id = "10000000-0000-4000-8000-000000000001";
const base: EvaluationParticipation = { id, profile: { location: null, skills: [], years_of_experience: null, seniority: null, education: { highest_completed: null, in_progress: null }, languages: [] }, screening_answers: [] };
const c = (kind: string, params: unknown = {}) => criterionSchema.parse({ id, label: "Test", importance: "required", kind, params });
const cases: [string, unknown, Partial<EvaluationParticipation["profile"]>, string][] = [
  ["manual", {}, {}, "unknown"],
  ...[null, "2", "3", "4"].map(years => ["min_years_experience", { min: "3" }, { years_of_experience: years }, years === null ? "unknown" : Number(years) >= 3 ? "met" : "not_met"] as [string, unknown, Partial<EvaluationParticipation["profile"]>, string]),
  ...[null, "junior", "senior"].map(seniority => ["seniority", { accepted: ["senior"] }, { seniority }, seniority === null ? "unknown" : seniority === "senior" ? "met" : "not_met"] as typeof cases[number]),
  ...[true, false].flatMap(accepts => [[null, null, "unknown"], ["master", null, "met"], ["bachelor", null, "met"], ["secondary", "master", accepts ? "met" : "not_met"], [null, "secondary", "not_met"]].map(([highest_completed, in_progress, result]) => ["education", { min_level: "bachelor", accepts_in_progress: accepts }, { education: { highest_completed, in_progress } }, result] as typeof cases[number])),
  ...[[], [{ code: "es", level: "native" }], [{ code: "en", level: "B1" }], [{ code: "en", level: "B2" }], [{ code: "en", level: "native" }]].map((languages, i) => ["language", { code: "en", min_level: "B2" }, { languages }, ["unknown", "not_met", "not_met", "met", "met"][i]] as typeof cases[number]),
  ["skill", { name: " Análisis " }, { skills: ["ANALISIS"] }, "met"], ["skill", { name: "SQL" }, {}, "unknown"],
  ...[null, { country: { id: "US", name: "US" }, state: null }, { country: { id: "MX", name: "MX" }, state: null }, { country: { id: "MX", name: "MX" }, state: { id: "09", name: "CDMX" } }, { country: { id: "MX", name: "MX" }, state: { id: "15", name: "México" } }].map((location, i) => ["location", { country: "MX", states: ["09"] }, { location: location && { ...location, municipality: null, postal_code: null, label: "" } }, ["unknown", "not_met", "unknown", "met", "not_met"][i]] as typeof cases[number]),
];
it.each(cases)("evaluates %s %#", (kind, params, profile, result) => expect(evaluateCriterion(c(kind, params), { ...base, profile: { ...base.profile, ...profile } })).toEqual({ result, source: kind === "manual" ? "none" : "auto" }));
it("matches whole country without state", () => expect(evaluateCriterion(c("location", { country: "MX", states: [] }), { ...base, profile: { ...base.profile, location: { country: { id: "MX", name: "México" }, state: null, municipality: null, postal_code: null, label: "México" } } }).result).toBe("met"));
it.each([undefined, id, "20000000-0000-4000-8000-000000000002"])("screening answer %s", option_id => expect(evaluateCriterion(c("screening_answer", { question_id: id, accepted_option_ids: [id] }), { ...base, screening_answers: option_id ? [{ question_id: id, option_id }] : [] }).result).toBe(option_id ? option_id === id ? "met" : "not_met" : "unknown"));
it.each(["met", "not_met"] as const)("mark always overrides %s", verdict => expect(evaluateCriterion(c("manual"), base, { verdict } as Mark)).toEqual({ result: verdict, source: "mark" }));
it("summary splits importance and ignores other participation marks", () => {
  const criteria = [c("manual"), { ...c("manual"), id: "other", importance: "desirable" as const }];
  expect(summarize(criteria, base, [{ participation_id: id, criterion_id: id, verdict: "met" }, { participation_id: "other", criterion_id: "other", verdict: "not_met" }] as Mark[])).toEqual({ required: { met: 1, not_met: 0, unknown: 0 }, desirable: { met: 0, not_met: 0, unknown: 1 } });
});
it.each([["required", "met", -1], ["required", "not_met", 1], ["desirable", "met", -1], ["required", "unknown", 1]] as const)("sort tiebreak %s %s", (importance, result, sign) => {
  const b = summarize([], base, []); const a = structuredClone(b); a[importance][result] = 1;
  expect(Math.sign(compareFit(a, b))).toBe(sign); expect(Math.sign(compareFit(b, a))).toBe(-sign); expect(compareFit(b, b)).toBe(0);
});
it("sort precedence and labels", () => {
  const a = summarize([], base, []); const b = structuredClone(a); a.required.met = 1; a.required.not_met = 10; b.desirable.met = 100;
  expect(compareFit(a, b)).toBeLessThan(0);
  expect([resultLabel("met"), resultLabel("not_met"), resultLabel("unknown")]).toEqual(["cumple", "no cumple", "sin evaluar"]);
  expect([sourceLabel({ source: "mark", result: "met" }, c("manual")), sourceLabel({ source: "auto", result: "met" }, c("screening_answer", { question_id: id, accepted_option_ids: [id] })), sourceLabel({ source: "auto", result: "met" }, c("skill", { name: "SQL" }))]).toEqual(["reclutador", "respuesta", "perfil"]);
});
