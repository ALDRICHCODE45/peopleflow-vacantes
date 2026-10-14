import {
  COMPENSATION_BASES,
  COMPENSATION_CURRENCIES,
  COMPENSATION_MODES,
  COMPENSATION_PAY_PERIODS,
} from "../compensation";
import { BENEFITS } from "../lists";
import { LANGUAGE_CODES, LANGUAGE_LEVELS, REQUESTER_KINDS } from "../nested";
import {
  CONTRACT_TYPES,
  PROFESSIONAL_AREAS,
  SENIORITIES,
  WORK_MODES,
  WORK_SCHEDULES,
} from "../scalars";

/**
 * Plain Spanish labels for the local draft editor.
 *
 * Every map is typed against the accepted contract constant, so an enum value
 * added to a schema without a label fails to compile instead of rendering an
 * implementation identifier at runtime. No label maps to a CEFR code.
 */

/** One select option: the wire value plus its visible Spanish label. */
export type DraftOption = { value: string; label: string };

/** Builds the option list in the accepted constant order. */
function optionsFrom<T extends string>(
  labels: Record<T, string>,
  values: readonly T[],
): DraftOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const WORK_MODE_LABELS = {
  onsite: "Presencial",
  remote: "Remoto",
  hybrid: "Híbrido",
} as const satisfies Record<(typeof WORK_MODES)[number], string>;

const WORK_SCHEDULE_LABELS = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
} as const satisfies Record<(typeof WORK_SCHEDULES)[number], string>;

const CONTRACT_TYPE_LABELS = {
  project: "Por proyecto",
  indefinite: "Indefinido",
  professional_services: "Servicios profesionales",
  temporary: "Temporal",
  internship: "Becas",
} as const satisfies Record<(typeof CONTRACT_TYPES)[number], string>;

const SENIORITY_LABELS = {
  intern: "Prácticas",
  junior: "Junior",
  mid: "Intermedio",
  senior: "Senior",
  lead: "Líder",
} as const satisfies Record<(typeof SENIORITIES)[number], string>;

const PROFESSIONAL_AREA_LABELS = {
  technology_systems: "Tecnología y sistemas",
  engineering: "Ingeniería",
  product: "Producto",
  design_creative: "Diseño y creatividad",
  sales_business_development: "Ventas y desarrollo de negocio",
  marketing_communications: "Marketing y comunicación",
  administration_finance: "Administración y finanzas",
  human_resources: "Recursos humanos",
  operations_production: "Operaciones y producción",
  logistics_transport: "Logística y transporte",
  customer_service_support: "Atención a clientes",
  healthcare: "Salud",
  education_training: "Educación y formación",
  legal: "Legal",
  construction_maintenance: "Construcción y mantenimiento",
  tourism_hospitality_gastronomy: "Turismo y gastronomía",
} as const satisfies Record<(typeof PROFESSIONAL_AREAS)[number], string>;

const BENEFIT_LABELS = {
  health_insurance: "Seguro de gastos médicos",
  computer_equipment: "Equipo de cómputo",
  flexible_schedule: "Horario flexible",
  remote_stipend: "Apoyo para trabajo remoto",
  training_budget: "Presupuesto de capacitación",
  extra_time_off: "Días libres adicionales",
  wellness: "Bienestar",
  annual_bonus: "Bono anual",
} as const satisfies Record<(typeof BENEFITS)[number], string>;

const LANGUAGE_LABELS = {
  es: "Español",
  en: "Inglés",
  other: "Otro",
} as const satisfies Record<(typeof LANGUAGE_CODES)[number], string>;

const LANGUAGE_LEVEL_LABELS = {
  basic: "Básico",
  intermediate: "Intermedio",
  advanced: "Avanzado",
  native: "Nativo",
} as const satisfies Record<(typeof LANGUAGE_LEVELS)[number], string>;

const REQUESTER_KIND_LABELS = {
  internal_area: "Área interna",
  client: "Cliente",
} as const satisfies Record<(typeof REQUESTER_KINDS)[number], string>;

const COMPENSATION_MODE_LABELS = {
  fixed: "Monto fijo",
  range: "Rango",
} as const satisfies Record<(typeof COMPENSATION_MODES)[number], string>;

const CURRENCY_LABELS = {
  MXN: "Peso mexicano (MXN)",
  USD: "Dólar estadounidense (USD)",
} as const satisfies Record<(typeof COMPENSATION_CURRENCIES)[number], string>;

const PAY_PERIOD_LABELS = {
  hourly: "Por hora",
  weekly: "Semanal",
  semimonthly: "Quincenal",
  monthly: "Mensual",
  yearly: "Anual",
} as const satisfies Record<(typeof COMPENSATION_PAY_PERIODS)[number], string>;

const BASIS_LABELS = {
  gross: "Bruto",
  net: "Neto",
} as const satisfies Record<(typeof COMPENSATION_BASES)[number], string>;

export const WORK_MODE_OPTIONS = optionsFrom(WORK_MODE_LABELS, WORK_MODES);
export const WORK_SCHEDULE_OPTIONS = optionsFrom(WORK_SCHEDULE_LABELS, WORK_SCHEDULES);
export const CONTRACT_TYPE_OPTIONS = optionsFrom(CONTRACT_TYPE_LABELS, CONTRACT_TYPES);
export const SENIORITY_OPTIONS = optionsFrom(SENIORITY_LABELS, SENIORITIES);
export const PROFESSIONAL_AREA_OPTIONS = optionsFrom(
  PROFESSIONAL_AREA_LABELS,
  PROFESSIONAL_AREAS,
);
export const REQUESTER_KIND_OPTIONS = optionsFrom(REQUESTER_KIND_LABELS, REQUESTER_KINDS);
export const LANGUAGE_OPTIONS = optionsFrom(LANGUAGE_LABELS, LANGUAGE_CODES);
export const LANGUAGE_LEVEL_OPTIONS = optionsFrom(LANGUAGE_LEVEL_LABELS, LANGUAGE_LEVELS);
export const COMPENSATION_MODE_OPTIONS = optionsFrom(
  COMPENSATION_MODE_LABELS,
  COMPENSATION_MODES,
);
export const CURRENCY_OPTIONS = optionsFrom(CURRENCY_LABELS, COMPENSATION_CURRENCIES);
export const PAY_PERIOD_OPTIONS = optionsFrom(PAY_PERIOD_LABELS, COMPENSATION_PAY_PERIODS);
export const BASIS_OPTIONS = optionsFrom(BASIS_LABELS, COMPENSATION_BASES);

/** Visible catalog label of one benefit code. */
export function benefitLabel(code: (typeof BENEFITS)[number]): string {
  return BENEFIT_LABELS[code];
}
