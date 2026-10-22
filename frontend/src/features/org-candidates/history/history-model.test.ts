import { expect, it } from "vitest";
import { orgCandidateHistorySchema } from "./history-model";
import { cv, edit, location, page, study } from "./test-fixtures";

it("accepts both frozen history examples, nullable attribution and opaque cursors", () => {
  expect(orgCandidateHistorySchema.parse(page)).toEqual(page);
  expect(orgCandidateHistorySchema.safeParse({ items: [], next_cursor: "opaque/+=?" }).success).toBe(true);
});
const values = [
  ["professional_title", "Desarrolladora"], ["current_company", "Empresa"], ["years_of_experience", "4.5"],
  ["seniority", "semi_senior"], ["education", [study]], ["languages", [{ code: "eng", level: "C1" }]],
  ["location", location], ["skills", ["React", "TypeScript"]], ["linkedin_url", "https://linkedin.com/in/example"], ["portfolio_url", "https://example.com"],
] as const;
it.each(values)("accepts %s API values, nulls and resets", (field, value) => {
  for (const change of [{ field, from: null, to: value }, { field, reset: true, from: value, to: null }]) {
    expect(orgCandidateHistorySchema.safeParse({ items: [{ ...edit, changes: [change] }], next_cursor: null }).success).toBe(true);
  }
});
it.each(["full_name", "email", "phone"])("only accepts redacted %s changes", field => {
  expect(orgCandidateHistorySchema.safeParse({ ...page, items: [{ ...edit, changes: [{ field, contact: true }] }] }).success).toBe(true);
  for (const change of [{ field, from: "private", to: "private" }, { field, contact: true, from: "private" }, { field, contact: true, reset: true }]) {
    expect(orgCandidateHistorySchema.safeParse({ ...page, items: [{ ...edit, changes: [change] }] }).success).toBe(false);
  }
});
it.each([
  { field: "unknown", from: null, to: null }, { field: "skills", contact: true },
  { field: "years_of_experience", from: "2", to: 4 }, { field: "years_of_experience", from: null, to: " 2" },
  { field: "years_of_experience", from: null, to: "61" }, { field: "seniority", from: null, to: "Senior" },
  { field: "education", from: [], to: { highest_completed: "bachelor", in_progress: null } },
  { field: "education", from: [], to: [{ ...study, extra: true }] },
  { field: "education", from: [], to: [{ ...study, status: "in_progress", end_year: 2020 }] },
  { field: "languages", from: [], to: [{ code: "eng", level: "c1" }] },
  { field: "languages", from: [], to: [{ code: "eng", level: "C1" }, { code: "eng", level: "B1" }] },
  { field: "location", from: null, to: { country: "MX" } }, { field: "location", from: null, to: { ...location, private: true } },
  { field: "skills", from: [], to: [42] }, { field: "portfolio_url", from: null, to: "not a URL" },
  { field: "current_company", from: null, to: 42 }, { field: "seniority", reset: false, from: "senior", to: "junior" },
  { field: "seniority", from: "senior" },
])("rejects field-aware drift: %j", change => {
  expect(orgCandidateHistorySchema.safeParse({ ...page, items: [{ ...edit, changes: [change] }] }).success).toBe(false);
});
it.each([
  { ...page, extra: true }, { items: [], next_cursor: 1 }, { items: [] },
  { ...page, items: [{ ...edit, changes: [] }] }, { ...page, items: [{ ...edit, at: "yesterday" }] },
  { ...page, items: [{ ...edit, actor: { ...edit.actor, email: "private" } }] },
  { ...page, items: [{ ...cv, participation_id: "invalid" }] }, { ...page, items: [{ ...cv, storage_key: "private" }] },
])("rejects envelope and event drift: %j", value => expect(orgCandidateHistorySchema.safeParse(value).success).toBe(false));
