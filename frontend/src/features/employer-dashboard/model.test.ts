import { expect, it } from "vitest";
import { dashboardSchema } from "./model";
import { dashboard } from "./test-fixtures";
it("accepts professional titles including null and semantic stage kinds", () => {
  for (const professional_title of ["Ingeniera", null]) for (const kind of ["new", "screening", "screening_ok", "in_process", "placement", "discarded", "custom"]) {
    const row = dashboard.recent[0];
    const result = dashboardSchema.safeParse({ ...dashboard, recent: [{ ...row, candidate: { ...row.candidate, professional_title }, stage: { ...row.stage, kind } }] });
    expect(result.success).toBe(true);
  }
});
it("accepts the exact backend response, including organic identity added manually", () => { expect(dashboardSchema.parse(dashboard)).toEqual(dashboard); });
it.each([
  { ...dashboard, published_vacancies: -1 }, { ...dashboard, in_process: 1.5 }, { ...dashboard, pool_added_last_7_days: "7" },
  { ...dashboard, positions: { covered: 3, required: 5, trend: 1 } }, { ...dashboard, extra: true },
  { ...dashboard, origin_by_day: dashboard.origin_by_day.slice(1) },
  { ...dashboard, origin_by_day: dashboard.origin_by_day.map((day, i) => i === 0 ? { ...day, date: "2026-02-30" } : day) },
  { ...dashboard, recent: [{ ...dashboard.recent[0], candidate: { ...dashboard.recent[0].candidate, id: "slug" } }] },
  { ...dashboard, recent: [{ ...dashboard.recent[0], source: "referral" }] },
  { ...dashboard, recent: [{ ...dashboard.recent[0], applied_at: "ayer" }] },
  { ...dashboard, recent: Array(11).fill(dashboard.recent[0]) }, { ...dashboard, recent: null },
])("rejects malformed or extra wire fields %#", value => { expect(dashboardSchema.safeParse(value).success).toBe(false); });
it("rejects duplicate or out-of-order daily entries", () => { const days = [...dashboard.origin_by_day]; days[1] = days[0]; expect(dashboardSchema.safeParse({ ...dashboard, origin_by_day: days }).success).toBe(false); });
it("rejects source/added-by mismatches", () => { expect(dashboardSchema.safeParse({ ...dashboard, recent: [{ ...dashboard.recent[0], added_by: dashboard.recent[1].added_by }] }).success).toBe(false); expect(dashboardSchema.safeParse({ ...dashboard, recent: [{ ...dashboard.recent[1], added_by: null }] }).success).toBe(false); });
it("accepts an empty company without inventing a ratio or rows", () => { expect(dashboardSchema.safeParse({ published_vacancies: 0, in_process: 0, pool_added_last_7_days: 0, positions: { covered: 0, required: 0 }, origin_by_day: dashboard.origin_by_day.map(day => ({ ...day, organic: 0, manual: 0 })), recent: [] }).success).toBe(true); });
