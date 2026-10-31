import type { ApplicationsPage } from "@/features/candidate-applications/model";
export type Application = ApplicationsPage["items"][number];
export type Period = "3m" | "30d";
const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monday = (date: Date) => { const value = day(date); value.setDate(value.getDate() - (value.getDay() + 6) % 7); return value; };
// UTC ordinals of LOCAL calendar components avoid elapsed-hour/DST rounding.
const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
export function dashboardInsights(items: readonly Application[], period: Period = "3m", now = new Date()) {
  const start = day(now);
  if (period === "30d") start.setDate(start.getDate() - 29);
  else { const date = start.getDate(); start.setDate(1); start.setMonth(start.getMonth() - 3); const last = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(); start.setDate(Math.min(date, last)); }
  const weeks: { week: string; submitted: number; in_process: number; closed: number }[] = [];
  for (const cursor = monday(start); cursor <= now; cursor.setDate(cursor.getDate() + 7)) weeks.push({ week: key(cursor), submitted: 0, in_process: 0, closed: 0 });
  const valid = items.filter(item => new Date(item.applied_at) <= now);
  for (const item of valid) {
    const applied = new Date(item.applied_at);
    if (applied < start) continue;
    const bucket = weeks.find(week => week.week === key(monday(applied)));
    if (bucket) bucket[item.status]++;
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const current = valid.filter(item => new Date(item.applied_at) >= monthStart).length;
  const previous = valid.filter(item => new Date(item.applied_at) >= previousStart && new Date(item.applied_at) < monthStart).length;
  const statuses = { in_process: 0, submitted: 0, closed: 0 };
  for (const item of items) statuses[item.status]++;
  const days = items.flatMap(item => typeof item.first_response_at === "string" ? [Math.max(0, ordinal(new Date(item.first_response_at)) - ordinal(new Date(item.applied_at)))] : []);
  const histogram = [...new Set(days)].sort((a, b) => a - b).map(value => ({ days: value, responses: days.filter(n => n === value).length }));
  return { weeks, month: { current, previous, difference: current - previous }, statuses, total: items.length, advanceRate: items.length ? Math.round(statuses.in_process / items.length * 100) : 0,
    responses: { available: items.some(item => item.first_response_at !== undefined), answered: days.length, waiting: items.filter(item => item.first_response_at === null).length, unknown: items.filter(item => item.first_response_at === undefined).length, average: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : null, histogram } };
}
/** Missing read state is unknown, never evidence of an unread message. */
export const isUnread = (item: Application) => item.message !== null && item.message_read_at === null;
