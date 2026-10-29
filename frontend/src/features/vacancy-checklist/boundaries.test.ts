import { expect, it } from "vitest";
import { criterionSchema, checklistSchema, markBodySchema } from "./model";
import { evaluateCriterion, compareFit, summarize, type EvaluationParticipation } from "./evaluate";
const id = "10000000-0000-4000-8000-000000000001";
const c = (kind: string, params: unknown) => criterionSchema.parse({ id, label: "Test", importance: "required", kind, params });
const p: EvaluationParticipation = { id, profile: { location: null, skills: [], years_of_experience: null, seniority: null, education: { highest_completed: null, in_progress: null }, languages: [{ code: "en", level: "C2" }] }, screening_answers: [] };
it("accepts canonical UUIDs including v7 per the agreed contract", () => expect(criterionSchema.safeParse({ id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", label: "Test", importance: "required", kind: "manual", params: {} }).success).toBe(true));
it("UUID identity duplicates are case insensitive", () => {
  const item = { id: "aaaaaaaa-0000-4000-8000-000000000001", label: "Test", importance: "required", kind: "manual", params: {} };
  expect(checklistSchema.safeParse({ version: "0", criteria: [item, { ...item, id: item.id.toUpperCase() }], reminder_stage_ids: [] }).success).toBe(false);
});
it("native outranks C2, not the reverse", () => {
  expect(evaluateCriterion(c("language", { code: "en", min_level: "native" }), p).result).toBe("not_met");
  expect(evaluateCriterion(c("language", { code: "en", min_level: "C2" }), { ...p, profile: { ...p.profile, languages: [{ code: "en", level: "native" }] } }).result).toBe("met");
});
it("summary counts all three verdicts for both importance levels", () => {
  const criteria = (["required", "desirable"] as const).flatMap(importance => [c("skill", { name: "SQL" }), c("language", { code: "en", min_level: "native" }), c("manual", {})].map(item => ({ ...item, importance })));
  expect(summarize(criteria, { ...p, profile: { ...p.profile, skills: ["SQL"] } }, [])).toEqual({ required: { met: 1, not_met: 1, unknown: 1 }, desirable: { met: 1, not_met: 1, unknown: 1 } });
});
it("sort every earlier tiebreak dominates later ones", () => {
  const empty = summarize([], p, []);
  const a = structuredClone(empty), b = structuredClone(empty);
  a.required.not_met = 1; b.required.not_met = 2; b.desirable.met = 100; expect(compareFit(a, b)).toBeLessThan(0);
  a.required.not_met = 2; a.desirable.met = 101; a.required.unknown = 100; expect(compareFit(a, b)).toBeLessThan(0);
});
it("text limits apply after trim including note boundaries", () => {
  expect(criterionSchema.parse({ ...c("manual", {}), label: ` ${"x".repeat(200)} ` }).label).toHaveLength(200);
  expect(markBodySchema.parse({ verdict: "met", note: ` ${"x".repeat(500)} ` }).note).toHaveLength(500);
});
