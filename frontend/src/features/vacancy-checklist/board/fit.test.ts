import { expect, it } from "vitest";
import { fitLine, matchesFit, pendingRequired, orderByFit } from "./fit";
import { boardFixture } from "@/features/pipeline-movement/board-fixture";
import type { Criterion } from "../model";
const criteria: Criterion[] = [{ id: "c", label: "Entrevista", kind: "manual", params: {}, importance: "required" }];
const summary = { required: { met: 4, not_met: 0, unknown: 1 }, desirable: { met: 1, not_met: 0, unknown: 1 } };
it("formats nonempty totals only", () => {
  expect(fitLine(summary)).toBe("Obligatorios 4/5 · Deseables 1/2 · 2 sin evaluar");
  expect(fitLine({ required: { met: 0, not_met: 0, unknown: 0 }, desirable: { met: 1, not_met: 0, unknown: 0 } })).toBe("Deseables 1/1");
});
it("keeps unknown, unmet and all-met predicates distinct", () => {
  expect(matchesFit(summary, new Set(["unknown"]))).toBe(true);
  expect(matchesFit(summary, new Set(["met"]))).toBe(false);
  expect(matchesFit(summary, new Set(["not_met"]))).toBe(false);
  expect(matchesFit({ ...summary, required: { met: 1, not_met: 1, unknown: 0 } }, new Set(["not_met"]))).toBe(true);
  expect(matchesFit({ ...summary, required: { met: 1, not_met: 0, unknown: 0 } }, new Set(["met"]))).toBe(true);
});
it("sorts stably and reminds only pending required criteria in configured stages", () => {
  const item = boardFixture().participations[0];
  const items = [item, { ...item, id: "second" }];
  expect(orderByFit(items, criteria, [])).toEqual(items);
  expect(pendingRequired(criteria, item, [], ["target"], "other")).toEqual([]);
  expect(pendingRequired(criteria, item, [], ["target"], "target")).toEqual(criteria);
  expect(pendingRequired([{ ...criteria[0], importance: "desirable" }], item, [], ["target"], "target")).toEqual([]);
});
