import { expect, it } from "vitest";
import { changeFilters, parseUrlState, serializeFilters, serializeUrlState, toExportBody } from "./url-state";
import { anaId, vacancyId } from "./test-fixtures";

it("round trips every contract filter, with repeatable event_type", () => {
  const raw = `actor_id=${anaId}&event_type=SessionStarted&event_type=SessionEnded&category=session&vacancy_id=${vacancyId}&from=2026-11-01&to=2026-11-04`;
  const parsed = parseUrlState(new URLSearchParams(raw));
  expect(parsed.filters).toEqual({ actor_id: anaId, event_type: ["SessionStarted", "SessionEnded"], category: "session", vacancy_id: vacancyId, from: "2026-11-01", to: "2026-11-04" });
  expect(parseUrlState(serializeUrlState(parsed))).toEqual(parsed);
  expect(serializeFilters(parsed.filters).getAll("event_type")).toEqual(["SessionStarted", "SessionEnded"]);
});

it("ignores unrelated parameters, a cursor and malformed values instead of forwarding them", () => {
  expect(parseUrlState(new URLSearchParams("cursor=abc&limit=500&secret=x"))).toEqual({ filters: {} });
  const dirty = parseUrlState(new URLSearchParams("actor_id=nope&vacancy_id=1&from=04-11-2026&to=2026-02-30&event_type=%3Cscript%3E&event_type=&category=a%20b"));
  expect(dirty.filters).toEqual({});
  expect(serializeUrlState(dirty).toString()).toBe("");
});

it("dedupes event types and keeps the first occurrence", () => {
  expect(parseUrlState(new URLSearchParams("event_type=A&event_type=B&event_type=A")).filters.event_type).toEqual(["A", "B"]);
});

it("changing a filter patches only that key and clearing removes it from the URL", () => {
  const state = parseUrlState(new URLSearchParams(`actor_id=${anaId}&from=2026-11-01`));
  const next = changeFilters(state, { from: undefined, event_type: ["SessionEnded"] });
  expect(serializeUrlState(next).toString()).toBe(`event_type=SessionEnded&actor_id=${anaId}`);
  expect(serializeUrlState(changeFilters(next, { actor_id: undefined, event_type: [] })).toString()).toBe("");
});

it("builds the export body from the same filters with event_types (contract §8.5)", () => {
  const state = parseUrlState(new URLSearchParams(`actor_id=${anaId}&event_type=SessionEnded&from=2026-11-01&to=2026-11-04`));
  expect(toExportBody(state.filters)).toEqual({ actor_id: anaId, event_types: ["SessionEnded"], from: "2026-11-01", to: "2026-11-04" });
  expect(toExportBody({})).toEqual({});
});
