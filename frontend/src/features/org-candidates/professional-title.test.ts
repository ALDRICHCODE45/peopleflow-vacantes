// T13 (candidate-dashboard-modern L29): organic talent-base titles now come from the latest
// application snapshot. The keys keep their shape (top-level `professional_title`,
// `original.professional_title`); `profile` never carries the title.
import { expect, it } from "vitest";
import { listSchema } from "./model";
import { candidate, page } from "./list/test-fixtures";
import { orgCandidateDetailSchema } from "./detail/detail-model";
import { detailFixture } from "./detail/test-fixtures";
import { candidateEditDetailFieldsSchema } from "./edit/edit-model";
import { editValueLabel, originalEditValues } from "./edit/edit-draft";
import { editFixture } from "./edit/test-fixtures";

it.each(["Backend Engineer", null])("list and detail decode an organic snapshot title %s top-level", title => {
  expect(listSchema.parse({ ...page, items: [{ ...candidate, kind: "organic", professional_title: title }] }).items[0].professional_title).toBe(title);
  const organic = detailFixture("organic");
  const parsed = orgCandidateDetailSchema.parse({ ...organic, professional_title: title });
  expect(parsed.professional_title).toBe(title);
});
it("the talent-base profile stays without the title", () => {
  expect(listSchema.safeParse({ ...page, items: [{ ...candidate, profile: { ...candidate.profile, professional_title: "QA" } }] }).success).toBe(false);
  const organic = detailFixture("organic");
  expect(orgCandidateDetailSchema.safeParse({ ...organic, profile: { ...organic.profile, professional_title: "QA" } }).success).toBe(false);
});
it("the correction «original» is the snapshot title, and none when the copy has no title", () => {
  const organic = editFixture("organic");
  const snapshot = { ...organic, professional_title: "Líder técnico", corrected_fields: ["professional_title" as const], original: { ...organic.original!, professional_title: "Backend Engineer" } };
  expect(candidateEditDetailFieldsSchema.parse(snapshot).original?.professional_title).toBe("Backend Engineer");
  expect(editValueLabel("professional_title", originalEditValues(snapshot)!.professional_title)).toBe("Backend Engineer");
  const legacy = { ...snapshot, original: { ...snapshot.original, professional_title: null } };
  expect(editValueLabel("professional_title", originalEditValues(legacy)!.professional_title)).toBe("Sin especificar");
});
