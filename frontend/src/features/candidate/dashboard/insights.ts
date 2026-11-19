import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
export type Application = ApplicationsPage["items"][number];
export type Status = Application["status"];
export type Week = { start: string; count: number; current: boolean };
export type Insights = ReturnType<typeof dashboardInsights>;

const WEEKS = 12;
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monday = (date: Date) => { const value = day(date); value.setDate(value.getDate() - (value.getDay() + 6) % 7); return value; };
// UTC ordinals of LOCAL calendar components avoid elapsed-hour/DST rounding.
const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

/** Every derived figure of the dashboard, from the loaded applications only (no event history exists). */
export function dashboardInsights(items: readonly Application[], now = new Date()) {
  const valid = items.filter(item => new Date(item.applied_at) <= now);
  // Constancy (Strava streaks): ISO weeks Monday–Sunday in local time, the running week last.
  const weeks: Week[] = [];
  for (let index = WEEKS - 1; index >= 0; index--) {
    const start = monday(now);
    start.setDate(start.getDate() - 7 * index);
    weeks.push({ start: key(start), count: 0, current: index === 0 });
  }
  for (const item of valid) {
    const week = weeks.find(candidate => candidate.start === key(monday(new Date(item.applied_at))));
    if (week) week.count++;
  }
  // The running week is not over yet: while it is empty it does not break the streak.
  let streak = 0;
  for (let index = weeks.at(-1)!.count ? WEEKS - 1 : WEEKS - 2; index >= 0 && weeks[index].count > 0; index--) streak++;
  const active = weeks.filter(week => week.count > 0).length;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = {
    current: valid.filter(item => new Date(item.applied_at) >= monthStart).length,
    previous: valid.filter(item => new Date(item.applied_at) >= previousStart && new Date(item.applied_at) < monthStart).length,
    // «Primer mes de actividad» only when nothing was sent before this month, never a fake delta from zero.
    first: valid.every(item => new Date(item.applied_at) >= monthStart),
  };

  const statuses: Record<Status, number> = { submitted: 0, in_process: 0, closed: 0 };
  for (const item of items) statuses[item.status]++;

  const days = items.flatMap(item => typeof item.first_response_at === "string" ? [Math.max(0, ordinal(new Date(item.first_response_at)) - ordinal(new Date(item.applied_at)))] : []);
  // Seven bins: the same day, 1–5 days, and 6 days or more.
  const histogram = [0, 0, 0, 0, 0, 0, 0];
  for (const value of days) histogram[Math.min(6, value)]++;
  const responses = {
    // An older server omits the field entirely; null means the company has not answered yet.
    available: items.some(item => item.first_response_at !== undefined),
    count: days.length,
    waiting: items.filter(item => item.first_response_at === null).length,
    average: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : null,
    histogram,
  };
  return { weeks, streak, active, month, statuses, total: items.length, responses };
}

/** Missing read state is unknown, never evidence of an unread message. */
export const isUnread = (item: Application) => item.message !== null && item.message_read_at === null;

export type ProfileGap = { completed: number; total: number; missing: readonly string[] };
export type Step =
  | { kind: "assessment"; item: AccountAssessment }
  | { kind: "message"; item: Application }
  | ({ kind: "profile" } & ProfileGap);
const changed = (item: Application) => Date.parse(item.updated_at ?? item.applied_at);

/**
 * «Siguiente paso» focus order (Linear «My issues»): the assessment that expires first, unread company messages
 * newest first, then an incomplete profile. Saved vacancies are never a step (L8). A source that is not loaded
 * contributes nothing; `assessments` must already be the eligible (actionable) set.
 */
export function nextSteps({ assessments = [], applications = [], profile }: { assessments?: readonly AccountAssessment[]; applications?: readonly Application[]; profile?: ProfileGap }): Step[] {
  return [
    ...[...assessments].sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at)).map(item => ({ kind: "assessment", item }) as const),
    ...applications.filter(isUnread).sort((a, b) => changed(b) - changed(a)).map(item => ({ kind: "message", item }) as const),
    ...(profile && profile.missing.length ? [{ kind: "profile", ...profile } as const] : []),
  ];
}
