import { dayLabel, MX_TIME_ZONE } from "./model";

/** Period rules of contract §2.0: inclusive civil dates in Mexico City, at most 366 days. */
export type Period = { from: string; to: string };
export type PeriodIssue = { field: "from" | "to"; message: string };
export const MAX_PERIOD_DAYS = 366;
export const DEFAULT_PERIOD_DAYS = 90;
const DAY_MS = 86_400_000;
const todayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: MX_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const dayTime = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
/** Strict `YYYY-MM-DD`: impossible days such as `2026-02-30` fail. */
export const isIsoDay = (value: string) => { const time = dayTime(value); return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value); };
export const mexicoToday = (now: Date = new Date()) => todayFormat.format(now);
export const addDays = (value: string, days: number) => new Date(dayTime(value) + days * DAY_MS).toISOString().slice(0, 10);
/** Days in the period, both ends included. */
export const periodDays = ({ from, to }: Period) => Math.round((dayTime(to) - dayTime(from)) / DAY_MS) + 1;

export const defaultPeriod = (today: string): Period => ({ from: addDays(today, 1 - DEFAULT_PERIOD_DAYS), to: today });
export const SHORTCUTS = [
  { value: "last_30", label: "Últimos 30 días" },
  { value: "last_90", label: "Últimos 90 días" },
  { value: "this_year", label: "Este año" },
] as const;
export type Shortcut = (typeof SHORTCUTS)[number]["value"];
export function shortcutPeriod(shortcut: Shortcut, today: string): Period {
  if (shortcut === "this_year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: addDays(today, shortcut === "last_30" ? -29 : 1 - DEFAULT_PERIOD_DAYS), to: today };
}
export const matchingShortcut = (period: Period, today: string) => SHORTCUTS.find(item => {
  const candidate = shortcutPeriod(item.value, today);
  return candidate.from === period.from && candidate.to === period.to;
})?.value;

/** Field errors for a draft period; empty when the API would accept it. */
export function periodIssues({ from, to }: Period): PeriodIssue[] {
  const issues: PeriodIssue[] = [];
  if (!isIsoDay(from)) issues.push({ field: "from", message: from ? "Elige una fecha válida." : "Elige la fecha de inicio." });
  if (!isIsoDay(to)) issues.push({ field: "to", message: to ? "Elige una fecha válida." : "Elige la fecha de fin." });
  if (issues.length) return issues;
  const days = periodDays({ from, to });
  if (days < 1) return [{ field: "to", message: "«Hasta» debe ser igual o posterior a «Desde»." }];
  if (days > MAX_PERIOD_DAYS) return [{ field: "to", message: `El periodo puede abarcar hasta ${MAX_PERIOD_DAYS} días. Elegiste ${days}.` }];
  return [];
}

/** «1 ago 2026 – 31 oct 2026». */
export const periodLabel = ({ from, to }: Period) => `${dayLabel(from)} – ${dayLabel(to)}`;
