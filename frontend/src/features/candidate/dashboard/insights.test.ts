import { expect, it } from "vitest";
import { dashboardInsights } from "./insights";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
type CandidateApplication = ApplicationsPage["items"][number];
const app = (applied_at: string, extra: Partial<CandidateApplication> = {}): CandidateApplication => ({ id: applied_at, applied_at, status: "submitted", message: null, vacancy: { id: "v", title: "Vacante", state: "open" }, company: { id: "c", name: "Empresa" }, ...extra });
it("buckets Monday ISO weeks in local time, including Sunday and year boundaries", () => {
  const now = new Date(2026, 0, 5, 12);
  const data = dashboardInsights([app(new Date(2026, 0, 4, 23).toISOString()), app(new Date(2026, 0, 5, 1).toISOString(), { status: "in_process" })], "30d", now);
  expect(data.weeks.slice(-2).map(w => [w.week, w.submitted, w.in_process])).toEqual([["2025-12-29", 1, 0], ["2026-01-05", 0, 1]]);
});
it("filters inclusive calendar periods, excludes future instants and compares full calendar months", () => {
  const now = new Date(2026, 2, 31, 12);
  const items = [app(new Date(2026, 2, 2).toISOString()), app(new Date(2026, 2, 1).toISOString()), app(new Date(2026, 1, 28).toISOString()), app(new Date(2026, 3, 1).toISOString())];
  const short = dashboardInsights(items, "30d", now);
  expect(short.weeks.reduce((n, w) => n + w.submitted, 0)).toBe(1);
  expect(short.month).toEqual({ current: 2, previous: 1, difference: 1 });
  expect(dashboardInsights(items, "3m", now).weeks.reduce((n, w) => n + w.submitted, 0)).toBe(3);
});
it("uses current statuses for advance rate and local calendar days for response averages without negatives", () => {
  const items = [app(new Date(2026, 2, 7, 23).toISOString(), { status: "in_process", first_response_at: new Date(2026, 2, 9, 1).toISOString() }), app(new Date(2026, 2, 9).toISOString(), { first_response_at: new Date(2026, 2, 8).toISOString() }), app(new Date(2026, 2, 9).toISOString(), { status: "closed", first_response_at: null })];
  const data = dashboardInsights(items, "3m", new Date(2026, 2, 31));
  expect(data.advanceRate).toBe(33);
  expect(data.responses).toEqual({ available: true, answered: 2, waiting: 1, unknown: 0, average: 1, histogram: [{ days: 0, responses: 1 }, { days: 2, responses: 1 }] });
});
it("distinguishes old servers, no responses, partial field rollout and empty accounts", () => {
  const base = app("2026-01-01T00:00:00Z");
  expect(dashboardInsights([base]).responses.available).toBe(false);
  expect(dashboardInsights([base, { ...base, first_response_at: null }]).responses).toMatchObject({ available: true, waiting: 1, unknown: 1, average: null });
  expect(dashboardInsights([])).toMatchObject({ advanceRate: 0, total: 0, responses: { average: null, histogram: [] } });
});
it("buckets a DST Sunday locally and counts calendar days without updated_at", () => {
  // Meaningful under TZ=America/New_York (DST starts 2026-03-08); deterministic in any zone.
  const applied = new Date(2026, 2, 8, 23, 30);
  const response = new Date(2026, 2, 9, 0, 30);
  const data = dashboardInsights([app(applied.toISOString(), { first_response_at: response.toISOString() })], "30d", new Date(2026, 2, 10, 12));
  expect(data.weeks.find(week => week.week === "2026-03-02")?.submitted).toBe(1);
  expect(data.responses.average).toBe(1);
});
