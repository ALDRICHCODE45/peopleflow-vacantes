import { expect, it } from "vitest";
import { profileSchema } from "./model";
import { boardFixture } from "./board-fixture";
import { boardFilterDimensions } from "./board-filter-dimensions";
import { applyFilters } from "./filters";

const profile = { location: null, skills: [], years_of_experience: "2.5", seniority: "junior" as const, education: { highest_completed: "bachelor" as const, in_progress: "master" as const }, languages: [{ code: "en", level: "B2" as const }] };
it("requires exactly the six H4 snapshot keys and strict nested vocabularies", () => {
  expect(profileSchema.parse(profile)).toEqual(profile);
  for (const key of Object.keys(profile)) expect(profileSchema.safeParse({ ...profile, [key]: undefined }).success).toBe(false);
  for (const invalid of [
    { ...profile, education_level: "bachelor" }, { ...profile, seniority: "mid" },
    ...[2, "01", "1.50", "60.5", "-1", "1\n"].map(years_of_experience => ({ ...profile, years_of_experience })),
    { ...profile, education: { highest_completed: "bachelor", in_progress: true } },
    { ...profile, education: { highest_completed: "bachelor" } },
    { ...profile, languages: [{ code: "en", level: "b2" }] },
    { ...profile, languages: [{ code: "en", level: "B2", name: "Inglés" }] },
  ]) expect(profileSchema.safeParse(invalid).success).toBe(false);
});
it("combines minimum education, ongoing studies, language minimums and seniority", () => {
  const board = boardFixture();
  board.participations = [
    profile,
    { ...profile, seniority: "senior" as const, education: { highest_completed: "master" as const, in_progress: null }, languages: [{ code: "es", level: "native" as const }] },
    { ...profile, seniority: null, education: { highest_completed: null, in_progress: null }, languages: [] },
  ].map((profile, i) => ({ ...board.participations[0], id: String(i), profile }));
  const dimensions = boardFilterDimensions(board);
  const matches = (selection: Record<string, Set<string>>) => applyFilters(board.participations, dimensions, selection).map(p => p.id);
  expect(matches({ education: new Set(["master"]) })).toEqual(["1"]);
  expect(matches({ education: new Set(["master", "@ongoing"]) })).toEqual(["0", "1"]);
  expect(matches({ education: new Set(["none"]) })).toEqual(["2"]);
  expect(matches({ languages: new Set(["en", "es", "@min:C1"]) })).toEqual(["1"]);
  expect(matches({ languages: new Set(["en", "es", "@min:B2"]) })).toEqual(["0", "1"]);
  expect(matches({ languages: new Set(["es", "@min:native"]) })).toEqual(["1"]);
  expect(matches({ languages: new Set(["none", "en", "@min:C2"]) })).toEqual(["2"]);
  expect(matches({ languages: new Set(["@min:C2"]) })).toEqual(["0", "1", "2"]);
  expect(matches({ seniority: new Set(["junior", "none"]), languages: new Set(["en"]) })).toEqual(["0"]);
});
it("uses decimal half-open experience buckets", () => {
  const board = boardFixture();
  board.participations = ["0", "0.9", "1", "2.9", "3", "4.9", "5", "60", null].map((years_of_experience, i) => ({ ...board.participations[0], id: String(i), profile: { ...profile, years_of_experience } }));
  const dimensions = boardFilterDimensions(board);
  for (const [bucket, ids] of [["under_one", ["0", "1"]], ["one_three", ["2", "3"]], ["three_five", ["4", "5"]], ["five_plus", ["6", "7"]], ["none", ["8"]]] as const) {
    expect(applyFilters(board.participations, dimensions, { experience: new Set([bucket]) }).map(p => p.id)).toEqual(ids);
  }
});
