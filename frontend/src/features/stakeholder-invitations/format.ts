import { daysUntil } from "./model";

const TIME_ZONE = "America/Mexico_City";
const parts = (value: string, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat("es-MX", { timeZone: TIME_ZONE, ...options }).formatToParts(new Date(value)).map(part => [part.type, part.value]));

/** «12 nov 2026», the short month without the trailing dot es-MX adds. */
export function formatDay(value: string): string {
  const { day, month, year } = parts(value, { day: "numeric", month: "short", year: "numeric" });
  return `${day} ${month.replace(".", "")} ${year}`;
}

/** «10:42», 24-hour clock. */
export function formatTime(value: string): string {
  const { hour, minute } = parts(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${hour}:${minute}`;
}

/** «5 nov 2026, 09:14»: identifies a pending invitation, since the API never returns its token again. */
export const formatInstant = (value: string) => `${formatDay(value)}, ${formatTime(value)}`;

export function formatRemaining(expiresAt: string, now: Date = new Date()): string {
  const days = daysUntil(expiresAt, now);
  return days <= 0 ? "vence hoy" : days === 1 ? "vence mañana" : `en ${days} días`;
}
