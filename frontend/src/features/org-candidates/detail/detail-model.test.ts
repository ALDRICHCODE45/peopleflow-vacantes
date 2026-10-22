import { expect, it } from "vitest";
import { orgCandidateDetailSchema } from "./detail-model";
import { detailFixture } from "./test-fixtures";

it.each(["manual", "organic"] as const)("accepts the frozen %s contract", kind => {
  expect(orgCandidateDetailSchema.parse(detailFixture(kind))).toEqual(detailFixture(kind));
});
const data = detailFixture();
const participation = data.participations[0];
it.each([
  { ...data, extra: true },
  { ...data, profile: { ...data.profile, extra: true } },
  { ...data, contact: { email: null } },
  { ...data, participations: [{ ...participation, entered_at: data.created_at, applied_at: undefined }] },
  { ...data, participations: [{ ...participation, vacancy: { ...participation.vacancy, lifecycle_state: "published" } }] },
  { ...data, participations: [{ ...participation, vacancy: { ...participation.vacancy, lifecycle: { publication: "deleted", process: "active" } } }] },
  { ...data, participations: [{ ...participation, cv: { ...participation.cv, name: "old.pdf" } }] },
  { ...data, participations: [{ ...participation, state: "hired" }] },
  { ...data, participations: [{ ...participation, state: "discarded", discard: { reason: { group: "candidate", key: "salary_expectation" }, comment: null, discarded_at: data.created_at } }] },
  { ...data, participations: [{ ...participation, state: "discarded" }] },
  { ...data, profile: { ...data.profile, languages: [{ code: "es", level: "Native" }] } },
])("rejects contract drift %#", value => {
  expect(orgCandidateDetailSchema.safeParse(value).success).toBe(false);
});
it("accepts nullable facts and a discarded participation", () => {
  const value = detailFixture();
  value.created_by = { id: value.id, name: null }; value.contact = { email: null, phone: null };
  value.participations[0] = { ...value.participations[0], state: "discarded", substate: null, added_by: null, cv: null, discard: { reason: { group: "recruiter", key: "other" }, comment: "Duplicado", discarded_at: value.created_at } };
  expect(orgCandidateDetailSchema.parse(value)).toEqual(value);
});
