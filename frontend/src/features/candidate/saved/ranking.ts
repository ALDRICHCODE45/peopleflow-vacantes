import { COMPENSATION_PAY_PERIODS, normalizeCompensationMoney } from "@/features/jobs/drafts/compensation";
import { PAY_PERIOD_OPTIONS } from "@/features/jobs/drafts/ui/draft-labels";
import { formatPublishedDate, formatRelativePublishedDate } from "@/features/jobs/formatters";
import type { SavedJobItem } from "@/features/saved-vacancies/model";

/**
 * «Postúlate primero» (design/candidate-saved-modern/02): the open, not-applied saved vacancies in one of three orders,
 * each row explained by facts the saved snapshot carries. Nothing here judges fit: there is no data for that.
 */
export type SortKey = "suggested" | "salary" | "recent";
export const SORTS: Record<SortKey, { label: string; caption: string }> = {
  suggested: { label: "Sugerido", caption: "Las que llevan más días publicadas, primero." },
  salary: { label: "Salario", caption: "Salario máximo publicado, de mayor a menor. Bruto y neto por separado." },
  recent: { label: "Recientes", caption: "Las que guardaste al último, primero." },
};
export const SORT_KEYS = Object.keys(SORTS) as SortKey[];

export type Reason = { text: string; lead: boolean };
type Job = SavedJobItem["job"];
type Basis = "gross" | "net";
type Pay = { min: string | null; max: string | null; top: string; currency: string; period: (typeof COMPENSATION_PAY_PERIODS)[number] | null; basis: Basis | null };

const DAY = 86_400_000;
/** UTC calendar days, like `formatRelativePublishedDate`, so a row and its facts never disagree. */
export const daysSince = (value: string, now: number) => Math.max(0, Math.floor(now / DAY) - Math.floor(Date.parse(value) / DAY));
const plural = (n: number, singular: string, multiple: string) => `${n} ${n === 1 ? singular : multiple}`;
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const BASIS: Record<Basis, string> = { gross: "bruto", net: "neto" };
const NO_BASIS = "bruto o neto sin indicar";
const period = (value: NonNullable<Pay["period"]>) => lowerFirst(PAY_PERIOD_OPTIONS.find(option => option.value === value)!.label);

function pay(job: Job): Pay | null {
  if (job.source === "vacancy") {
    const value = job.compensation;
    if (value === null) return null;
    const top = value.mode === "fixed" ? value.amount! : value.max!;
    return { min: value.mode === "fixed" ? null : value.min, max: value.mode === "fixed" ? value.amount : value.max, top, currency: value.currency, period: value.pay_period, basis: value.basis };
  }
  const value = job.legacy_salary;
  if (value === null) return null;
  return { min: value.min, max: value.max, top: (value.max ?? value.min)!, currency: value.currency, period: null, basis: null };
}

/** Exact grouping of a decimal money string («$26,000», «$26,000.50»), never through a float. */
function money(value: string) {
  const [whole, fraction] = normalizeCompensationMoney(value).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction === "00" ? "" : `.${fraction}`}`;
}
/** Short form for a glance («22k»); approximate by design, the exact amount is in the preview. */
function thousands(value: string) {
  const amount = Number(value);
  if (amount < 1000) return money(value).slice(1);
  const k = amount / 1000;
  return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`;
}

/** «$22k–26k» over «bruto» (or the basis it lacks), with the currency and period only when they are not MXN monthly. */
export function shortSalary(job: Job): { amount: string; note: string } | null {
  const value = pay(job);
  if (value === null) return null;
  const amount = value.min !== null && value.max !== null ? `$${thousands(value.min)}–${thousands(value.max)}`
    : value.max !== null ? `${value.basis === null ? "Hasta " : ""}$${thousands(value.max)}` : `Desde $${thousands(value.min!)}`;
  const note = [value.currency !== "MXN" && value.currency, value.period && value.period !== "monthly" && period(value.period), value.basis ? BASIS[value.basis] : NO_BASIS].filter(Boolean).join(" · ");
  return { amount, note };
}

function salaryReason(job: Job): Reason {
  const value = pay(job);
  if (value === null) return { text: "Salario no publicado", lead: false };
  const amount = `Hasta ${money(value.top)}${value.currency === "MXN" ? "" : ` ${value.currency}`}`;
  if (value.basis === null) return { text: `${amount}, sin indicar bruto o neto`, lead: true };
  return { text: `${amount} ${BASIS[value.basis]}${value.period && value.period !== "monthly" ? ` ${period(value.period)}` : ""}`, lead: true };
}

/** «Hace 2 h», «Ayer», «Hace 3 días» or the date, as a phrase after «Guardada». */
export function savedAgo(value: string, now: number) {
  const relative = formatRelativePublishedDate(value, now);
  return /^\d/u.test(relative) ? `el ${relative}` : lowerFirst(relative);
}
/** Day-based publication age for the facts grid: «Hoy», «Ayer», «Hace 6 días» or the date. */
export function publishedAgo(value: string, now: number) {
  const days = daysSince(value, now);
  return days === 0 ? "Hoy" : days === 1 ? "Ayer" : days < 7 ? `Hace ${days} días` : formatPublishedDate(value);
}

const ONLY: Partial<Record<Job["work_mode"], string>> = { remote: "La única remota", hybrid: "La única híbrida" };
/** At most two chips: the reason for the current place, then one distinguishing fact. */
export function reasons(item: SavedJobItem, sort: SortKey, queue: SavedJobItem[], now: number): Reason[] {
  const { job } = item;
  const days = daysSince(job.published_at, now);
  const list: Reason[] = [sort === "suggested" ? { text: days === 0 ? "Publicada hoy" : `Lleva ${plural(days, "día", "días")} publicada`, lead: true }
    : sort === "salary" ? salaryReason(job) : { text: `Guardada ${savedAgo(item.saved_at, now)}`, lead: true }];
  const only = ONLY[job.work_mode];
  if (only && queue.length >= 2 && queue.filter(other => other.job.work_mode === job.work_mode).length === 1) list.push({ text: only, lead: false });
  if (sort !== "salary" && pay(job) === null) list.push({ text: "Salario no publicado", lead: false });
  return list.slice(0, 2);
}

/** Exact comparison of two non-negative decimal money strings. */
function compareMoney(left: string, right: string) {
  const [a, b] = [normalizeCompensationMoney(left), normalizeCompensationMoney(right)];
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
}
const basisRank = (value: Pay | null) => value === null ? 3 : value.basis === "gross" ? 0 : value.basis === "net" ? 1 : 2;
const periodRank = (value: Pay["period"]) => value === null ? COMPENSATION_PAY_PERIODS.length : COMPENSATION_PAY_PERIODS.indexOf(value);
/**
 * Salary order: one scale per basis, currency and period. Bruto and neto are never ranked against each other (nor MXN
 * against USD, nor monthly against yearly): bruto ranks first, then neto, then a salary without basis, then none.
 */
function bySalary(left: SavedJobItem, right: SavedJobItem) {
  const [a, b] = [pay(left.job), pay(right.job)];
  return basisRank(a) - basisRank(b)
    || (a && b ? (a.currency === b.currency ? 0 : a.currency === "MXN" ? -1 : 1) || periodRank(a.period) - periodRank(b.period) || compareMoney(b.top, a.top) : 0);
}
const newestSaved = (left: SavedJobItem, right: SavedJobItem) => Date.parse(right.saved_at) - Date.parse(left.saved_at);

export function rank(queue: SavedJobItem[], sort: SortKey, now: number): SavedJobItem[] {
  const compare = sort === "suggested" ? (a: SavedJobItem, b: SavedJobItem) => daysSince(b.job.published_at, now) - daysSince(a.job.published_at, now)
    : sort === "salary" ? bySalary : () => 0;
  return queue.slice().sort((a, b) => compare(a, b) || newestSaved(a, b));
}

/** «5 guardadas · 3 por postularte · 1 ya no está disponible». */
export function summary(total: number, pending: number, closed: number) {
  if (total === 0) return "Guarda vacantes para compararlas y postularte cuando quieras.";
  const rest = closed > 0 ? `${closed} ya no ${closed === 1 ? "está disponible" : "están disponibles"}` : total === 1 ? "sigue abierta" : "todas siguen abiertas";
  return `${plural(total, "guardada", "guardadas")} · ${pending} por postularte · ${rest}`;
}
