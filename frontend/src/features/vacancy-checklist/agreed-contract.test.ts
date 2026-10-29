import { expect, it } from "vitest";
import { checklistSchema, criterionSchema, updateCriterionIdentity } from "./model";
import { evaluateCriterion, type EvaluationParticipation } from "./evaluate";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const c = (kind: string, params: unknown, criterionId = id) => ({ id: criterionId, label: "Test", importance: "required", kind, params });
it.each(["opaque", "01", "1.0", "1\n"])("rejects non-counter version %s", version => expect(checklistSchema.safeParse({ version, criteria: [], reminder_stage_ids: [] }).success).toBe(false));
it.each([
  [c("skill", { name: "Análisis" }), c("skill", { name: " ANALISIS " }, "bbbbbbbb-0000-4000-8000-000000000001")],
  [c("location", { country: "MX", states: [] }), c("location", { country: "US", states: [] }, "bbbbbbbb-0000-4000-8000-000000000001")],
  [c("screening_answer", { question_id: id, accepted_option_ids: [id] }), c("screening_answer", { question_id: id.toUpperCase(), accepted_option_ids: [id] }, "bbbbbbbb-0000-4000-8000-000000000001")],
])("rejects agreed duplicates %#", criteria => expect(checklistSchema.safeParse({ version: "0", criteria, reminder_stage_ids: [] }).success).toBe(false));
it("screening question and option IDs compare case insensitively", () => {
  const p: EvaluationParticipation = { id, profile: { skills: [], languages: [], location: null, years_of_experience: null, seniority: null, education: { highest_completed: null, in_progress: null } }, screening_answers: [{ question_id: id.toUpperCase(), option_id: id.toUpperCase() }] };
  expect(evaluateCriterion(criterionSchema.parse(c("screening_answer", { question_id: id, accepted_option_ids: [id] })), p).result).toBe("met");
});
it("identity changes only for kind/params edits, not object key order or label/importance", () => {
  const before = criterionSchema.parse(c("education", { min_level: "bachelor", accepts_in_progress: false }));
  expect(updateCriterionIdentity(before, { ...before, label: "Nuevo", importance: "desirable" }).id).toBe(id);
  expect(updateCriterionIdentity(before, criterionSchema.parse({ ...before, params: { accepts_in_progress: false, min_level: "bachelor" } })).id).toBe(id);
  expect(updateCriterionIdentity(before, criterionSchema.parse({ ...before, params: { min_level: "master", accepts_in_progress: false } })).id).not.toBe(id);
  expect(updateCriterionIdentity(before, criterionSchema.parse(c("manual", {}))).id).not.toBe(id);
});
