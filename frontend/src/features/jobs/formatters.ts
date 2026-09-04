const WORK_MODE_LABELS = {
  onsite: "Presencial",
  remote: "Remoto",
  hybrid: "Híbrido",
} as const;

const EMPLOYMENT_TYPE_LABELS = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
  contract: "Por contrato",
  internship: "Beca",
} as const;

const SENIORITY_LABELS = {
  intern: "Prácticas",
  junior: "Junior",
  mid: "Medio",
  senior: "Senior",
  lead: "Líder",
} as const;

export type WorkMode = keyof typeof WORK_MODE_LABELS;
export type EmploymentType = keyof typeof EMPLOYMENT_TYPE_LABELS;
export type Seniority = keyof typeof SENIORITY_LABELS;

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

const SALARY_CURRENCIES = ["MXN", "USD"] as const;
export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];

/** Deterministic Mexico Spanish currency amounts with the ISO code and no decimals. */
const salaryFormatters = new Map<SalaryCurrency, Intl.NumberFormat>(
  SALARY_CURRENCIES.map((currency) => [
    currency,
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }),
  ]),
);

/** ICU may inject narrow/no-break spaces; outputs must use ordinary spaces. */
function normalizeAmountSpaces(amount: string): string {
  return amount.replace(/[\u00a0\u202f\u2007\u2009]/g, " ");
}

function formatSalaryAmount(value: number, currency: SalaryCurrency): string {
  return normalizeAmountSpaces(salaryFormatters.get(currency)!.format(value));
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
