import type { JobItem } from "./types";

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
