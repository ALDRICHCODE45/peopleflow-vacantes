import type { JobPayFrequency } from "./enrich";
import type { JobItem, PublicJobItem } from "./types";
import { BASIS_OPTIONS, PAY_PERIOD_OPTIONS } from "./drafts/ui/draft-labels";
import { normalizeCompensationMoney } from "./drafts/compensation";

/**
 * Fixed Mexico Spanish label maps keyed by the schema-inferred wire enums, so
 * a backend enum accepted by the Zod schema but missing a label fails to
 * typecheck here instead of silently rendering `undefined` at runtime.
 */
const WORK_MODE_LABELS = {
 onsite: "Presencial",
 remote: "Remoto",
 hybrid: "Híbrido",
} as const satisfies Record<JobItem["work_mode"], string>;

const EMPLOYMENT_TYPE_LABELS = {
 full_time: "Tiempo completo",
 part_time: "Medio tiempo",
 contract: "Por contrato",
 internship: "Beca",
} as const satisfies Record<JobItem["employment_type"], string>;

const SENIORITY_LABELS = {
 intern: "Prácticas",
 junior: "Junior",
 mid: "Medio",
 senior: "Senior",
 lead: "Líder",
} as const satisfies Record<JobItem["seniority"], string>;

export type WorkMode = JobItem["work_mode"];
export type EmploymentType = JobItem["employment_type"];
export type Seniority = JobItem["seniority"];
export type PayFrequency = JobPayFrequency;

/**
 * Exhaustive Mexico Spanish labels for the prototype pay-frequency union, so a
 * frequency added to the enrichment without a label here fails to typecheck
 * instead of rendering `undefined`.
 */
const PAY_FREQUENCY_LABELS = {
 monthly: "Mensual",
 yearly: "Anual",
 hourly: "Por hora",
} as const satisfies Record<JobPayFrequency, string>;

/** How often a prototype vacancy claims to pay, in Mexico Spanish. */
export function payFrequencyLabel(value: JobPayFrequency): string {
 return PAY_FREQUENCY_LABELS[value];
}

export function workModeLabel(value: WorkMode): string {
 return WORK_MODE_LABELS[value];
}

export function employmentTypeLabel(value: EmploymentType): string {
 return EMPLOYMENT_TYPE_LABELS[value];
}

export function seniorityLabel(value: Seniority): string {
 return SENIORITY_LABELS[value];
}

/** Deterministic long-form Mexico Spanish date, always rendered in UTC. */
const publishedDateFormat = new Intl.DateTimeFormat("es-MX", {
 dateStyle: "long",
 timeZone: "UTC",
});

export function formatPublishedDate(value: string): string {
 return publishedDateFormat.format(new Date(value));
}

/** Deterministic long-form Mexico Spanish closing date, always rendered in UTC. */
const closingDateFormat = new Intl.DateTimeFormat("es-MX", {
 dateStyle: "long",
 timeZone: "UTC",
});

/** Prototype-only closing date; the wire contract has no such field. */
export function formatClosingDate(value: string): string {
 return closingDateFormat.format(new Date(value));
}

export type SalaryCurrency = JobItem["salary_currency"];

/** Deterministic Mexico Spanish currency amounts with the ISO code and no decimals. */
function salaryFormatter(currency: SalaryCurrency): Intl.NumberFormat {
 return new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency,
  currencyDisplay: "code",
  maximumFractionDigits: 0,
 });
}

/**
 * One deterministic formatter per exact backend wire currency. The
 * `Record<SalaryCurrency, …>` key requirement makes a currency added to
 * the Zod schema without a formatter here a compile error, so the map
 * can never be partial for any schema-valid `salary_currency`.
 */
const salaryFormatters: Record<SalaryCurrency, Intl.NumberFormat> = {
 MXN: salaryFormatter("MXN"),
 USD: salaryFormatter("USD"),
};

/** ICU may inject narrow/no-break spaces; outputs must use ordinary spaces. */
function normalizeAmountSpaces(amount: string): string {
 return amount.replace(/[\u00a0\u202f\u2007\u2009]/g, " ");
}

function formatSalaryAmount(value: number, currency: SalaryCurrency): string {
 return normalizeAmountSpaces(salaryFormatters[currency].format(value));
}

export type SalaryInput = {
 min?: number;
 max?: number;
 currency: SalaryCurrency;
};

/** Exact public vacancy money strings, with shared draft period/basis labels. */
export function formatPublicCompensation(value: NonNullable<PublicJobItem["compensation"]>): string {
 const amount = value.mode === "fixed"
  ? normalizeCompensationMoney(value.amount!)
  : `${normalizeCompensationMoney(value.min!)} – ${normalizeCompensationMoney(value.max!)}`;
 const period = PAY_PERIOD_OPTIONS.find((option) => option.value === value.pay_period)!.label;
 const basis = BASIS_OPTIONS.find((option) => option.value === value.basis)!.label;
 return `${amount} ${value.currency} · ${period} · ${basis}`;
}

/** Legacy salary has no period or basis; preserve its existing public labels. */
export function formatPublicSalary(job: PublicJobItem): string | null {
 if (job.source === "vacancy") return job.compensation === null ? null : formatPublicCompensation(job.compensation);
 if (job.legacy_salary === null) return null;
 return formatSalary({
  min: job.legacy_salary.min === null ? undefined : Number(job.legacy_salary.min),
  max: job.legacy_salary.max === null ? undefined : Number(job.legacy_salary.max),
  currency: job.legacy_salary.currency,
 });
}

export function formatSalary(input: SalaryInput): string | null {
 const { min, max, currency } = input;
 if (min !== undefined && max !== undefined) {
  return `${formatSalaryAmount(min, currency)} – ${formatSalaryAmount(max, currency)}`;
 }
 if (min !== undefined) {
  return `Desde ${formatSalaryAmount(min, currency)}`;
 }
 if (max !== undefined) {
  return `Hasta ${formatSalaryAmount(max, currency)}`;
 }
 return null;
}
