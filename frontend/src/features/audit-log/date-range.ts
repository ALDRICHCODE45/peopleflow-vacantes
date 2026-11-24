import { MX_TIME_ZONE } from "./model";

/** Range presets of the audit filters and the export panel. The API keeps taking `from` / `to` (Mexico City civil days, both ends included). */
export type RangeKey = "today" | "7" | "30" | "custom";
export type DayRange = { from?: string; to?: string };
export const PRESETS: readonly { key: Exclude<RangeKey, "custom">; label: string; days: number }[] = [
  { key: "today", label: "Hoy", days: 1 }, { key: "7", label: "7 días", days: 7 }, { key: "30", label: "30 días", days: 30 },
];

const MX_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: MX_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 86_400_000;
/** Today in Mexico City as `YYYY-MM-DD`: after 18:00 local the UTC date is already tomorrow's. */
export const mxToday = (now: Date = new Date()): string => MX_DAY.format(now);
export const addDays = (day: string, delta: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
export const presetRange = (key: Exclude<RangeKey, "custom">, today: string): { from: string; to: string } =>
  ({ from: addDays(today, 1 - PRESETS.find(preset => preset.key === key)!.days), to: today });

/** The preset a range matches, «custom» for any other range and null when there is none. */
export function rangeKeyOf({ from, to }: DayRange, today: string): RangeKey | null {
  if (!from && !to) return null;
  const preset = PRESETS.find(({ key }) => { const range = presetRange(key, today); return range.from === from && range.to === to; });
  return preset?.key ?? "custom";
}

/** `2026-11-01` → «1 de noviembre de 2026» (a civil day: no time zone conversion). */
export function dayName(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

export function describeRange(range: DayRange, today: string): string {
  const { from, to } = range;
  const key = rangeKeyOf(range, today);
  if (key === "today") return `Hoy (${dayName(to!)})`;
  if (key === "7" || key === "30") return `Últimos ${key} días (${dayName(from!)} – ${dayName(to!)})`;
  if (from && to) return `Del ${dayName(from)} al ${dayName(to)}`;
  return from ? `Desde el ${dayName(from)}` : `Hasta el ${dayName(to!)}`;
}
