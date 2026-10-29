import { describe, expect, it } from "vitest";
import { checklistSchema, criterionSchema, markSchema, marksSchema, markBodySchema } from "@/features/vacancy-checklist/model";
export const id = "10000000-0000-4000-8000-000000000001";
export const criterion = (kind = "manual", params: unknown = {}) => ({ id, label: " Criterio ", importance: "required", kind, params });
export const mark = { participation_id: id, criterion_id: id, verdict: "met", note: "  ", marked_by: { id, full_name: "Ana" }, marked_at: "2026-10-28T12:00:00Z" };
const valid = [criterion(), criterion("min_years_experience", { min: "60.0" }), criterion("seniority", { accepted: ["senior"] }), criterion("education", { min_level: "bachelor", accepts_in_progress: false }), criterion("language", { code: "en", min_level: "native" }), criterion("skill", { name: "SQL" }), criterion("location", { country: "MX", states: ["09"] }), criterion("screening_answer", { question_id: id, accepted_option_ids: [id] })];
describe("schemas", () => {
  it.each(valid)("accepts each kind %#", value => expect(criterionSchema.parse(value).label).toBe("Criterio"));
  it.each([
    { ...criterion(), label: " " }, { ...criterion(), label: "x".repeat(201) }, { ...criterion(), label: undefined }, { ...criterion(), extra: true }, criterion("manual", { extra: 1 }), criterion("other"),
    ...["61", "01", "3.12", " 3", 3, null].map(min => criterion("min_years_experience", { min })),
    criterion("seniority", { accepted: [] }), criterion("seniority", { accepted: ["senior", "senior"] }), criterion("seniority", { accepted: ["other"] }),
    criterion("education", { min_level: "bachelor" }), criterion("language", { code: "", min_level: "B2" }), criterion("language", { code: "en", min_level: "b2" }),
    criterion("skill", { name: "x".repeat(61) }), criterion("skill", { name: " " }), criterion("location", { country: "mx", states: [] }), criterion("location", { country: "MX", states: ["09", "09"] }), criterion("location", { country: "MX", states: Array(33).fill("09") }),
    criterion("screening_answer", { question_id: id, accepted_option_ids: [] }), criterion("screening_answer", { question_id: "bad", accepted_option_ids: [id] }), criterion("screening_answer", { question_id: id, accepted_option_ids: Array(9).fill(id) }),
  ])("rejects required/invalid/too_long/not_allowed/duplicate %#", value => expect(criterionSchema.safeParse(value).success).toBe(false));
  it("accepts empty checklist and marks, normalizes notes", () => {
    expect(checklistSchema.parse({ version: "0", criteria: [], reminder_stage_ids: [] }).version).toBe("0");
    expect(marksSchema.parse({ items: [mark] }).items[0].note).toBeNull();
    expect(markBodySchema.parse({ verdict: "not_met", note: " hi " }).note).toBe("hi");
  });
  it.each([Array(51).fill(criterion()), [criterion(), criterion()], ...[valid[4], valid[5], valid[7]].map(c => [c, { ...c, id: "20000000-0000-4000-8000-000000000002" }])])("rejects oversized/duplicate criteria %#", criteria => expect(checklistSchema.safeParse({ version: "0", criteria, reminder_stage_ids: [] }).success).toBe(false));
  it.each([{ ...mark, note: "x".repeat(501) }, { ...mark, verdict: "unknown" }, { ...mark, marked_at: "today" }, { ...mark, extra: 1 }])("rejects invalid mark %#", value => expect(markSchema.safeParse(value).success).toBe(false));
});
