import { expect, it } from "vitest";
import { activeFilterCount, applyFilters, clearFilters, filterChips, optionCount, toggleFilter, type FilterDimension } from "./filters";
import { substateDimension } from "./substates";
import { boardFixture } from "./board-fixture";
import { boardFilterDimensions } from "./board-filter-dimensions";
import { discardCatalog } from "./discard-text";

it("column and discard declarations preserve catalog order and combine with substates", () => {
  const board = boardFixture(); board.stages[2].kind = "in_process";
  const item = { ...board.participations[0], stage_id: "interview", substate_id: "tech" };
  const discarded = { ...item, stage_id: board.exit.id, discard: { reason: { group: "candidate" as const, key: "other" as const }, previous_stage_id: "interview", discarded_at: item.moved_at } };
  const dimensions = boardFilterDimensions(board);
  expect(dimensions.map(d => d.label)).toEqual(["Subestado", "Columna", "Motivo de descarte"]);
  expect(dimensions[1].options.map(o => o.value)).toEqual([...board.stages, board.exit].map(s => s.id));
  expect(dimensions[2].options.map(o => o.value)).toEqual(discardCatalog.flatMap(g => g.reasons.map(r => `${g.group}:${r.key}`)));
  expect(applyFilters([item, discarded], dimensions, { column: new Set(["screen"]), substate: new Set(["tech"]) })).toEqual([]);
  expect(applyFilters([item, discarded], dimensions, { column: new Set(["screen", "interview"]), substate: new Set(["tech"]) })).toEqual([item]);
  expect(applyFilters([item, discarded], dimensions, { discard: new Set(["candidate:other", "recruiter:other"]) })).toEqual([discarded]);
  expect(applyFilters([item, discarded], dimensions, { discard: new Set(["recruiter:other"]) })).toEqual([]);
});

const items = [{ color: "red", size: "s" }, { color: "blue", size: "s" }, { color: "red", size: "l" }];
const dimensions: FilterDimension<typeof items[number]>[] = ["color", "size"].map(key => ({ key, label: key, options: (key === "color" ? ["red", "blue"] : ["s", "l"]).map(value => ({ value, label: value })), match: (item, selected) => selected.has(item[key as "color" | "size"]) }));
it("ignores empty groups, ORs values and ANDs dimensions without mutating items", () => {
  expect(applyFilters(items, dimensions, {})).toEqual(items);
  expect(applyFilters(items, dimensions, { color: new Set() })).toEqual(items);
  expect(applyFilters(items, dimensions, { color: new Set(["red", "blue"]), size: new Set(["s"]) })).toEqual(items.slice(0, 2));
  expect(applyFilters(items, dimensions, { color: new Set(["missing"]) })).toEqual([]);
});
it("toggles immutably, counts values, labels chips in catalog order and clears one/all groups", () => {
  const original = { color: new Set(["blue"]), size: new Set(["s"]) };
  const next = toggleFilter(original, "color", "red");
  expect(original.color).toEqual(new Set(["blue"]));
  expect(activeFilterCount(next)).toBe(3);
  expect(filterChips(dimensions, next).map(chip => chip.label)).toEqual(["color: red", "color: blue", "size: s"]);
  expect(toggleFilter(next, "color", "red")).toEqual(original);
  expect(clearFilters(next, "color")).toEqual({ size: new Set(["s"]) });
  expect(clearFilters(next)).toEqual({});
  expect(optionCount(items, dimensions[0], "red")).toBe(2);
});
it("substates preserve catalog order, include none only in process and exclude discarded items", () => {
  const board = boardFixture(); board.stages[2].kind = "in_process";
  board.substates = [{ id: "tech", name: "Técnica" }];
  const item = { ...board.participations[0], stage_id: board.stages[2].id, substate_id: null };
  const dimension = substateDimension(board);
  expect(dimension.options.map(option => option.value)).toEqual(["tech", "none"]);
  const candidates = [item, { ...item, substate_id: "tech" }, { ...item, stage_id: "new" }, { ...item, discard: { reason: { group: "recruiter" as const, key: "profile_mismatch" as const }, previous_stage_id: item.stage_id, discarded_at: item.moved_at } }];
  expect(applyFilters(candidates, [dimension], { substate: new Set(["none"]) })).toEqual([item]);
  expect(applyFilters(candidates, [dimension], { substate: new Set(["none", "tech"]) })).toEqual(candidates.slice(0, 2));
  expect(optionCount(candidates, dimension, "none")).toBe(1);
});
