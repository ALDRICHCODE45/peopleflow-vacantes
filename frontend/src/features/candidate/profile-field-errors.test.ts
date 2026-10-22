import { expect, it } from "vitest";
import { profileFieldIssues, sortProfileIssues } from "./profile-field-errors";
it("orders fields by visual groups, row index and control order", () => {
  const paths = ["languages.1.level", "education.1.status", "education.0.status", "education.0.field", "education.0.level", "location.municipality", "location.state", "location.country", "yearsOfExperience"];
  expect(sortProfileIssues(paths.map(path => ({ path, message: "Revisa" }))).map(issue => issue.path)).toEqual(["location.country", "location.state", "location.municipality", "yearsOfExperience", "education.0.level", "education.0.field", "education.0.status", "education.1.status", "languages.1.level"]);
});
it("maps bracketed paths without accepting arbitrary DOM selectors", () => {
  expect(profileFieldIssues([{ field: "education[1].status", code: "invalid" }, { field: "languages[0].code", code: "duplicate" }, { field: "years_of_experience", code: "invalid" }, { field: 'x"] button', code: "invalid" }]).map(issue => issue.path)).toEqual(["education.1.status", "languages.0.code", "yearsOfExperience"]);
});
