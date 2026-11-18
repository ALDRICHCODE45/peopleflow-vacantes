import { expect, it } from "vitest";
import { parseUrlState, serializeUrlState, changeFilters, changeView, toListQuery } from "./url-state";
it("round trips every contract key, repeatable values and opaque cursor", () => {
 const raw = "q=Mariana&origin=manual&vacancy=a&vacancy=b&state=14&municipality=14039&seniority=senior&years=3_5&years=none&language=en&language=es&language_min_level=native&education_level=bachelor&education_in_progress=true&view=cards&cursor=a%2B%2F%3D";
 const parsed = parseUrlState(new URLSearchParams(raw));
 expect(parseUrlState(serializeUrlState(parsed))).toEqual(parsed);
 expect(parsed.filters.vacancy).toEqual(["a", "b"]);
 expect(parsed.cursor).toBe("a+/=");
 expect(toListQuery(parsed)).not.toHaveProperty("view");
});
it("changing a filter resets cursor but switching view preserves filters and cursor", () => {
 const state = parseUrlState(new URLSearchParams("q=Ana&language=en&cursor=opaque"));
 expect(changeFilters(state, { origin: "organic" }).cursor).toBeUndefined();
 expect(changeView(state, "cards")).toEqual({ ...state, view: "cards" });
 expect(changeView(state, "cards").filters.q).toBe("Ana");
});
it("never sends orphan language or education modifiers", () => {
 const state = parseUrlState(new URLSearchParams("language_min_level=C1&education_in_progress=true"));
 expect(serializeUrlState(state).toString()).not.toMatch(/min_level|in_progress/);
 const selected = parseUrlState(new URLSearchParams("language=en&language_min_level=C1&education_level=master&education_in_progress=true"));
 expect(serializeUrlState(changeFilters(selected, { language: [], education_level: undefined })).toString()).not.toMatch(/min_level|in_progress/);
});
it("serializes repeatable countries and the independent active-process filter, and removes them", () => {
 const state = parseUrlState(new URLSearchParams("country=MX&country=US&country=none&active_process=true&cursor=old"));
 expect(state.filters).toEqual({ country: ["MX", "US", "none"], active_process: "true" });
 expect(serializeUrlState(state).getAll("country")).toEqual(["MX", "US", "none"]);
 expect(toListQuery(state).filters?.active_process).toBe("true");
 const cleared = changeFilters(state, { country: [], active_process: undefined });
 expect(serializeUrlState(cleared).toString()).toBe("");
});
it("defaults to table and ignores unrelated URL parameters", () => {
 expect(parseUrlState(new URLSearchParams("view=bad&secret=x"))).toEqual({ view: "table", filters: {} });
});
it("reads the dashboard's added dates («Nuevos en la base») and sends them to the list, dropping malformed or reversed ones", () => {
 const state = parseUrlState(new URLSearchParams("added_from=2026-10-10&added_to=2026-11-08&cursor=old"));
 expect(state.filters).toEqual({ added_from: "2026-10-10", added_to: "2026-11-08" });
 expect(serializeUrlState(state).toString()).toBe("added_from=2026-10-10&added_to=2026-11-08&cursor=old");
 expect(toListQuery(state).filters).toEqual({ added_from: "2026-10-10", added_to: "2026-11-08" });
 expect(parseUrlState(new URLSearchParams("added_from=2026-11-08")).filters).toEqual({ added_from: "2026-11-08" });
 expect(parseUrlState(new URLSearchParams("added_from=2026-13-40&added_to=yesterday")).filters).toEqual({});
 // The backend answers from > to with 422 added_to.range; the pair is dropped instead.
 expect(parseUrlState(new URLSearchParams("added_from=2026-11-08&added_to=2026-10-10")).filters).toEqual({});
 expect(changeFilters(state, { added_from: undefined, added_to: undefined }).filters).toEqual({});
});
