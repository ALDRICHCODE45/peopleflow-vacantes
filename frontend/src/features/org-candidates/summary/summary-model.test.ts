import { expect, it } from "vitest";
import { candidatesSummarySchema } from "./summary-model";

import { summary } from "./test-fixtures";
it("accepts the summary contract and an empty organization", () => {
  expect(candidatesSummarySchema.parse(summary)).toEqual(summary);
  expect(candidatesSummarySchema.safeParse({ total: 0, with_active_process: 0, added_last_7_days: 0, by_kind: { manual: 0, organic: 0 } }).success).toBe(true);
});
it.each(["total", "with_active_process", "added_last_7_days"] as const)("rejects invalid %s counts", key => {
  for (const value of [-1, 1.5, "1", null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(candidatesSummarySchema.safeParse({ ...summary, [key]: value }).success).toBe(false);
  }
});
it.each(["manual", "organic"] as const)("rejects invalid by_kind.%s", key => {
  for (const value of [-1, 1.5, "1", null]) {
    expect(candidatesSummarySchema.safeParse({ ...summary, by_kind: { ...summary.by_kind, [key]: value } }).success).toBe(false);
  }
});
it("rejects missing fields, response drift and inconsistent origin totals", () => {
  for (const value of [null, {}, { ...summary, extra: true }, { ...summary, by_kind: { ...summary.by_kind, extra: 1 } }, { ...summary, total: 9 }]) {
    expect(candidatesSummarySchema.safeParse(value).success).toBe(false);
  }
});
it("does not infer additional cross-metric constraints", () => {
  expect(candidatesSummarySchema.safeParse({ ...summary, with_active_process: 9, added_last_7_days: 12 }).success).toBe(true);
});
