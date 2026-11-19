/** es-MX dates for the dashboard copy (artboard 04), built from fixed parts so no locale data adds periods. */
export const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const SHORT_DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
const clock = (date: Date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Hoy, 9:05», «Ayer», «Hace 3 días», «18 nov». */
export function relativeTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = ordinal(now) - ordinal(date);
  if (days <= 0) return `Hoy, ${clock(date)}`;
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} días`;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}
/** «vie 20 nov». */
export const shortDate = (iso: string) => { const date = new Date(iso); return `${SHORT_DAYS[date.getDay()]} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`; };
/** «Miércoles 18 de noviembre». */
export const longDate = (date: Date) => capitalize(`${date.toLocaleDateString("es-MX", { weekday: "long" })} ${date.getDate()} de ${date.toLocaleDateString("es-MX", { month: "long" })}`);
/** «Noviembre» / «octubre». */
export const monthName = (date: Date) => date.toLocaleDateString("es-MX", { month: "long" });
export { capitalize };
