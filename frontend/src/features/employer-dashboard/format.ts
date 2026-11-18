import { dayLabel, MX_TIME_ZONE, number } from "@/features/company-metrics/model";
import { mexicoToday } from "@/features/company-metrics/period";
import type { DashboardHeader, OriginSection } from "./model";

/** es-MX presentation of the dashboard (artboard 09). Instants are read in Mexico City time; civil dates as they are. */
const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: MX_TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const clockParts = new Intl.DateTimeFormat("en-US", { timeZone: MX_TIME_ZONE, hour: "numeric", minute: "2-digit", hourCycle: "h23" });
/** «9:18», «18:05» in Mexico City. */
const clockFormat = { format: (at: Date) => { const parts = clockParts.formatToParts(at); const get = (type: string) => parts.find(item => item.type === type)?.value ?? ""; return `${Number(get("hour"))}:${get("minute")}`; } };
const shortDayFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, day: "numeric", month: "short" });
const civilShort = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const civilLong = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const civilDay = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "numeric", month: "short" });
const DAY_MS = 86_400_000;
const noDots = (value: string) => value.replaceAll(".", "").replaceAll(",", "").replace(/\sde\s/g, " ").replace(/\s+/g, " ").trim();
const civil = (date: string) => new Date(`${date}T12:00:00Z`);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Buenos días 06:00–11:59, Buenas tardes 12:00–18:59, Buenas noches otherwise (Mexico City). */
export function greeting(now: Date): string {
  const hour = Number(hourFormat.format(now));
  return hour >= 6 && hour < 12 ? "Buenos días" : hour >= 12 && hour < 19 ? "Buenas tardes" : "Buenas noches";
}
export const firstName = (fullName: string | null | undefined) => fullName?.trim().split(/\s+/u)[0] || null;
export const scopeLabel = (scope: DashboardHeader["scope"]) => scope === "company" ? "Toda la empresa" : "Tus vacantes asignadas";

/** «Actualizado hoy 10:42 · 10 oct 2026 – 8 nov 2026»: when the numbers were computed and the window (rule 2). */
export function freshness({ as_of, window }: Pick<DashboardHeader, "as_of" | "window">, now: Date): string {
  const computed = new Date(as_of);
  const moment = mexicoToday(computed) === mexicoToday(now)
    ? `hoy ${clockFormat.format(computed)}`
    : `${dayLabel(mexicoToday(computed))}, ${clockFormat.format(computed)}`;
  return `Actualizado ${moment} · ${dayLabel(window.from)} – ${dayLabel(window.to)}`;
}

/** The consequence of an open delivery: what is still missing. */
export function shortfall(delivered: number, target: number): string {
  if (target === 0) return "Sin meta de candidatos";
  const missing = target - delivered;
  if (missing <= 0) return `${number.format(delivered)} de ${number.format(target)} candidatos entregados`;
  return `${missing === 1 ? "Falta" : "Faltan"} ${number.format(missing)} de ${number.format(target)} candidatos`;
}
/** Business days since the commitment date (contract §3.2); the help popover says they are business days. */
export const overdueLabel = (days: number) => days === 0 ? "Vencida" : `Venció hace ${number.format(days)} ${days === 1 ? "día hábil" : "días hábiles"}`;
export const stalledLabel = (days: number) => `${number.format(days)} ${days === 1 ? "día" : "días"} sin avanzar`;
/** «Vence mañana», «Vence mié 11 nov», with the long words for the row's accessible name. */
export function dueLabel(commitment: string, today: string): { short: string; long: string } {
  const diff = dayDiff(today, commitment);
  if (diff === 0) return { short: "Vence hoy", long: "vence hoy" };
  if (diff === 1) return { short: "Vence mañana", long: "vence mañana" };
  const parts = civilLong.formatToParts(civil(commitment));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return { short: `Vence ${noDots(civilShort.format(civil(commitment)).replace(",", ""))}`, long: `vence el ${part("weekday")} ${part("day")} de ${part("month")}` };
}
/** «Hoy, 9:18», «Ayer, 18:05», «6 nov, 16:47». */
export function relativeMoment(instant: string, now: Date): string {
  const at = new Date(instant);
  const diff = dayDiff(mexicoToday(at), mexicoToday(now));
  const clock = clockFormat.format(at);
  return diff === 0 ? `Hoy, ${clock}` : diff === 1 ? `Ayer, ${clock}` : `${noDots(shortDayFormat.format(at))}, ${clock}`;
}
/** «8 nov» from a civil date. */
export const shortDay = (date: string) => noDots(civilDay.format(civil(date)));
/** «dom 8 nov» from a civil date. */
export const weekdayDay = (date: string) => noDots(civilShort.format(civil(date)).replace(",", ""));
/** «2 – 8 nov», «28 oct – 3 nov». */
export function dayRange(from: string, to: string): string {
  const [a, b] = [shortDay(from), shortDay(to)];
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(" ")[0]} – ${b}` : `${a} – ${b}`;
}

/** Stage badges in one family (artboard 09): the early stages and the exit neutral, the rest the process tone. */
export const stageTone = (kind: string) => ["new", "screening", "screening_ok", "discarded"].includes(kind) ? "stage-neutral" : "stage-process";
export const initials = (name: string) => name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(word => word.charAt(0).toUpperCase()).join("") || "?";

export type AveragePoint = { date: string; from: string; organic: number; manual: number; organicSum: number; manualSum: number };
/** 7-day trailing average (artboard 09): one point per day that closes a full week, with the raw sums of that week. */
export function trailingAverage(days: OriginSection["by_day"], size = 7): AveragePoint[] {
  const points: AveragePoint[] = [];
  for (let end = size - 1; end < days.length; end += 1) {
    const week = days.slice(end - size + 1, end + 1);
    const organicSum = week.reduce((sum, item) => sum + item.organic, 0);
    const manualSum = week.reduce((sum, item) => sum + item.manual, 0);
    points.push({ date: days[end].date, from: week[0].date, organic: organicSum / size, manual: manualSum / size, organicSum, manualSum });
  }
  return points;
}
