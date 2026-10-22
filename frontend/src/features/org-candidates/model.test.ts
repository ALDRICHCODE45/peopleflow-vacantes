import { expect, it } from "vitest";
import { listSchema } from "./model";
import { candidate, page } from "./list/test-fixtures";
it("accepts the frozen list example and a manual record without participations", () => {
  expect(listSchema.parse(page)).toEqual(page);
  expect(listSchema.safeParse({ ...page, items: [{ ...candidate, latest_participation: null }] }).success).toBe(true);
  expect(listSchema.safeParse({ ...page, items: [{ ...candidate, kind: "organic", professional_title: null }] }).success).toBe(true);
});
it("accepts organic items carrying a company correction of title or company (E2; QA L18)", () => {
  expect(listSchema.safeParse({ ...page, items: [{ ...candidate, kind: "organic", professional_title: "Desarrollador Full Stack", current_company: "Acme" }] }).success).toBe(true);
});
it.each([
  { ...page, extra: true }, { ...page, total: -1 }, { ...page, next_cursor: undefined },
  ...[{ id: "bad" }, { professional_title: undefined }, { contact: {} }, { last_activity_at: "bad" },
    { profile: { ...candidate.profile, extra: true } }, { profile: { ...candidate.profile, languages: [{ code: "en", level: "Native" }] } },
    { latest_participation: { ...candidate.latest_participation, entered_at: candidate.last_activity_at } },
    { latest_participation: { ...candidate.latest_participation, vacancy: { ...candidate.latest_participation.vacancy, lifecycle: { publication: "draft", process: null } } } },
  ].map(patch => ({ ...page, items: [{ ...candidate, ...patch }] })),
])("rejects contract drift %#", value => expect(listSchema.safeParse(value).success).toBe(false));
