import { expect, it } from "vitest";
import { vacancyDetail } from "../api/public-fixtures";
import { deriveRelatedSearches } from "./chips";
const job = { ...vacancyDetail, professional_area: "design_creative" as const, work_mode: "remote" as const, seniority: "senior" as const };
const expected = [
  { label: "Diseño y creatividad en Ciudad de México", href: "/vacantes?state=09&professional_area=design_creative" },
  { label: "Diseño y creatividad remoto", href: "/vacantes?work_mode=remote&professional_area=design_creative" },
  { label: "Diseño y creatividad · Senior", href: "/vacantes?seniority=senior&professional_area=design_creative" },
  { label: "Vacantes en Ciudad de México", href: "/vacantes?state=09" },
];
it("derives canonical chips using the existing Mexican Spanish labels", () => {
  expect(deriveRelatedSearches(job)).toEqual(expected);
});
it("omits each chip whose source field is absent", () => {
  expect(deriveRelatedSearches({ ...job, professional_area: null })).toEqual([expected[3]]);
  expect(deriveRelatedSearches({ ...job, location: null })).toEqual([expected[1], expected[2]]);
  expect(deriveRelatedSearches({ ...job, location: { ...job.location, state: null } })).toEqual([expected[1], expected[2]]);
  expect(deriveRelatedSearches({ ...job, seniority: null })).toEqual([expected[0], expected[1], expected[3]]);
  expect(deriveRelatedSearches({ ...job, work_mode: "hybrid" })).toEqual([expected[0], expected[2], expected[3]]);
  expect(deriveRelatedSearches({ ...job, professional_area: null, location: null, seniority: null })).toEqual([]);
});
