import { describe, expect, it } from "vitest";
import { dashboardInsights, nextSteps } from "./insights";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
type CandidateApplication = ApplicationsPage["items"][number];
const app = (applied_at: string, extra: Partial<CandidateApplication> = {}): CandidateApplication => ({ id: applied_at, applied_at, status: "submitted", message: null, vacancy: { id: "v", title: "Vacante", state: "open" }, company: { id: "c", name: "Empresa" }, ...extra });
const local = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).toISOString();
// Wednesday 18 Nov 2026; its ISO week starts Monday 16 Nov.
const now = new Date(2026, 10, 18, 13);

describe("weekly constancy", () => {
  it("returns the last 12 Monday weeks, oldest first, with the running week flagged", () => {
    const { weeks } = dashboardInsights([app(local(11, 16, 9)), app(local(11, 18, 9)), app(local(9, 1))], now);
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toEqual({ start: "2026-08-31", count: 1, current: false });
    expect(weeks[1]).toEqual({ start: "2026-09-07", count: 0, current: false });
    expect(weeks[11]).toEqual({ start: "2026-11-16", count: 2, current: true });
    expect(weeks.filter(week => week.current)).toHaveLength(1);
  });
  it("buckets a Sunday into the week that started the Monday before, and ignores applications older than 12 weeks or in the future", () => {
    const { weeks } = dashboardInsights([app(local(11, 15, 23)), app(local(8, 1)), app(local(11, 19))], now);
    expect(weeks.find(week => week.start === "2026-11-09")?.count).toBe(1);
    expect(weeks.reduce((sum, week) => sum + week.count, 0)).toBe(1);
  });
  it("counts the streak back from the running week, without breaking it while the running week is still empty", () => {
    const three = [app(local(11, 17)), app(local(11, 10)), app(local(11, 3)), app(local(10, 20))];
    expect(dashboardInsights(three, now)).toMatchObject({ streak: 3, active: 4 });
    const lastWeekOnly = [app(local(11, 10)), app(local(11, 4))];
    expect(dashboardInsights(lastWeekOnly, now)).toMatchObject({ streak: 2, active: 2 });
    const gap = [app(local(10, 27))];
    expect(dashboardInsights(gap, now)).toMatchObject({ streak: 0, active: 1 });
    expect(dashboardInsights([], now)).toMatchObject({ streak: 0, active: 0 });
  });
});

describe("month, status and advance", () => {
  it("compares full calendar months and excludes future instants", () => {
    const items = [app(local(11, 2)), app(local(11, 1, 0)), app(local(10, 31, 23)), app(local(11, 30))];
    expect(dashboardInsights(items, now).month).toEqual({ current: 2, previous: 1, first: false });
  });
  it("marks the first month of activity only when nothing was sent before this month", () => {
    expect(dashboardInsights([app(local(11, 2))], now).month).toEqual({ current: 1, previous: 0, first: true });
    expect(dashboardInsights([app(local(11, 2)), app(local(9, 2))], now).month).toEqual({ current: 1, previous: 0, first: false });
  });
  it("counts current statuses over every loaded application", () => {
    const items = [app(local(11, 18), { status: "in_process" }), app(local(11, 18), { status: "in_process" }), app(local(11, 18), { status: "closed" }), app(local(1, 2))];
    expect(dashboardInsights(items, now)).toMatchObject({ total: 4, statuses: { submitted: 1, in_process: 2, closed: 1 } });
  });
});

describe("first response", () => {
  it("averages local calendar days with one decimal and never goes negative", () => {
    const items = [app(new Date(2026, 2, 7, 23).toISOString(), { first_response_at: new Date(2026, 2, 9, 1).toISOString() }), app(new Date(2026, 2, 9).toISOString(), { first_response_at: new Date(2026, 2, 9).toISOString() }), app(new Date(2026, 2, 9).toISOString(), { first_response_at: new Date(2026, 2, 13).toISOString() }), app(local(3, 9), { first_response_at: null })];
    expect(dashboardInsights(items, now).responses).toEqual({ available: true, count: 3, waiting: 1, average: 2, histogram: [1, 0, 1, 0, 1, 0, 0] });
  });
  it("puts six days or more in the last histogram bin", () => {
    const items = [9, 6, 30].map(days => app(new Date(2026, 2, 1).toISOString(), { first_response_at: new Date(2026, 2, 1 + days).toISOString() }));
    expect(dashboardInsights(items, now).responses.histogram).toEqual([0, 0, 0, 0, 0, 0, 3]);
    expect(dashboardInsights(items, now).responses.average).toBe(15);
  });
  it("distinguishes an older server without the field from an account still waiting", () => {
    expect(dashboardInsights([app(local(11, 1))], now).responses).toMatchObject({ available: false, count: 0, average: null });
    expect(dashboardInsights([app(local(11, 1), { first_response_at: null })], now).responses).toMatchObject({ available: true, count: 0, waiting: 1, average: null });
  });
});

describe("next step focus order", () => {
  const assessment = (id: string, expires_at: string, status: AccountAssessment["status"] = "created"): AccountAssessment => ({ id, application_id: null, vacancy: { id: "v", title: "Vacante" }, company: { id: "c", name: "Empresa" }, status, created_at: local(11, 1), expires_at, finished_at: null, answered_count: 0, total_count: 63, estimated_minutes: 10 });
  const unread = (id: string, updated_at: string) => app(local(11, 1), { id, status: "closed", message: "Gracias", message_read_at: null, updated_at });
  const profile = { completed: 10, total: 12, missing: ["teléfono", "ubicación"] };
  it("puts the assessment that expires first, then unread messages newest first, then the incomplete profile", () => {
    const steps = nextSteps({
      assessments: [assessment("later", local(12, 1)), assessment("soon", local(11, 20))],
      applications: [unread("old", local(11, 2)), app(local(11, 3), { id: "read", status: "closed", message: "Hola", message_read_at: local(11, 4) }), unread("new", local(11, 5)), app(local(11, 3), { id: "unknown", status: "closed", message: "Hola" })],
      profile,
    });
    expect(steps.map(step => step.kind === "profile" ? "profile" : `${step.kind}:${step.item.id}`)).toEqual(["assessment:soon", "assessment:later", "message:new", "message:old", "profile"]);
  });
  it("is empty when nothing is pending, and skips sources that are not loaded", () => {
    expect(nextSteps({ assessments: [], applications: [app(local(11, 1))], profile: { completed: 12, total: 12, missing: [] } })).toEqual([]);
    expect(nextSteps({ profile })).toEqual([{ kind: "profile", ...profile }]);
  });
});
