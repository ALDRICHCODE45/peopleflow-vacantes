import {
  employmentTypeLabel,
  seniorityLabel,
  workModeLabel,
} from "../../formatters";
import type {
  EmploymentType,
  SalaryCurrency,
  Seniority,
  WorkMode,
} from "../../formatters";
import { createJobRequestSchema } from "../schemas";
import type { VacancyPreviewValues } from "../VacancyPreview";

/**
 * Form model for the create-vacancy screen: the draft state shape, the contract
 * option catalogs, DOM normalization, and schema-backed validation.
 *
 * This module is the single place that talks to `createJobRequestSchema`, so the
 * composition root never parses the wire contract itself.
 */

/**
 * Field state of the form. The shape is the preview component's value contract,
 * reused rather than re-declared so the two can never drift apart.
 */
export type VacancyFormValues = VacancyPreviewValues;

/** A brand-new screen has no contract value yet: required enums start unchosen. */
export const INITIAL_VALUES: VacancyFormValues = {
  title: "",
  description: "",
  location: "",
  workMode: "",
  employmentType: "",
  seniority: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "MXN",
};

/**
 * Contract enums in render order, each entry pairing the exact wire value with
 * its fixed Spanish label. Every value `POST /jobs` accepts appears here, and
 * nothing the API does not accept does.
 */
export const WORK_MODE_OPTIONS = [
  { value: "onsite", label: workModeLabel("onsite") },
  { value: "remote", label: workModeLabel("remote") },
  { value: "hybrid", label: workModeLabel("hybrid") },
] as const satisfies ReadonlyArray<{ value: WorkMode; label: string }>;

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: employmentTypeLabel("full_time") },
  { value: "part_time", label: employmentTypeLabel("part_time") },
  { value: "contract", label: employmentTypeLabel("contract") },
  { value: "internship", label: employmentTypeLabel("internship") },
] as const satisfies ReadonlyArray<{ value: EmploymentType; label: string }>;

export const SENIORITY_OPTIONS = [
  { value: "intern", label: seniorityLabel("intern") },
  { value: "junior", label: seniorityLabel("junior") },
  { value: "mid", label: seniorityLabel("mid") },
  { value: "senior", label: seniorityLabel("senior") },
  { value: "lead", label: seniorityLabel("lead") },
] as const satisfies ReadonlyArray<{ value: Seniority; label: string }>;

/**
 * Both currencies the wire contract accepts. MXN starts selected because it is
 * the backend's own documented default, so the visible value never disagrees
 * with what the API would store.
 */
export const SALARY_CURRENCY_OPTIONS = [
  { value: "MXN", label: "MXN" },
  { value: "USD", label: "USD" },
] as const satisfies ReadonlyArray<{ value: SalaryCurrency; label: string }>;

/** One error slot per request field the schema can reject. */
export type VacancyField =
  | "title"
  | "description"
  | "work_mode"
  | "employment_type"
  | "seniority"
  | "location"
  | "salary_min"
  | "salary_max"
  | "salary_currency";

export type VacancyFieldErrors = Partial<Record<VacancyField, string>>;

/**
 * Contract fields in canonical order. Validation, error mapping, and focus all
 * read this one order, so the first invalid field is deterministic.
 */
export const VACANCY_FIELDS = [
  "title",
  "description",
  "work_mode",
  "employment_type",
  "seniority",
  "location",
  "salary_min",
  "salary_max",
  "salary_currency",
] as const satisfies ReadonlyArray<VacancyField>;

const FIELD_IDS: Record<VacancyField, string> = {
  title: "vacancy-title",
  description: "vacancy-description",
  work_mode: "vacancy-work-mode",
  employment_type: "vacancy-employment-type",
  seniority: "vacancy-seniority",
  location: "vacancy-location",
  salary_min: "vacancy-salary-min",
  salary_max: "vacancy-salary-max",
  salary_currency: "vacancy-salary-currency",
};

export const groupTitleId = (field: VacancyField) =>
  `${FIELD_IDS[field]}-title`;
export const errorId = (field: VacancyField) => `${FIELD_IDS[field]}-error`;
export const controlId = (field: VacancyField) => FIELD_IDS[field];

/** One deterministic Spanish message per contract rule the schema can fail. */
const FIELD_MESSAGES: Record<VacancyField, string> = {
  title: "Ingresá un título para la vacante.",
  description: "Ingresá una descripción para la vacante.",
  work_mode: "Elegí una modalidad de trabajo.",
  employment_type: "Elegí una jornada de trabajo.",
  seniority: "Elegí un seniority para la vacante.",
  location: "La ubicación no es válida.",
  salary_min: "El salario mínimo debe ser un número entero de 0 o más.",
  salary_max: "El salario máximo debe ser un número entero de 0 o más.",
  salary_currency: "Elegí una moneda válida.",
};

/** The cross-field salary rule reports itself on the maximum bound. */
const SALARY_RANGE_MESSAGE =
  "El salario máximo debe ser mayor o igual al salario mínimo.";

/**
 * Stated only after a valid attempt: this build has no recruiter login yet, so
 * a draft cannot be persisted and no request is issued.
 */
const AUTH_REQUIRED_NOTICE =
  "Para guardar el borrador necesitás iniciar sesión como reclutador. La autenticación todavía no está disponible en esta versión, así que no se envió ninguna solicitud.";

function isVacancyField(value: unknown): value is VacancyField {
  return (
    typeof value === "string" &&
    (VACANCY_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Narrows a controlled toggle-group value back to the contract enum. Anything
 * outside the rendered options collapses to "still unchosen".
 */
export function pickOption<T extends string>(
  options: ReadonlyArray<{ value: T }>,
  candidate: string | undefined,
): T | "" {
  return options.find((option) => option.value === candidate)?.value ?? "";
}

/**
 * First invalid field in canonical order, or null when nothing failed. Focus
 * uses it so an invalid submit always lands on the same control, regardless of
 * the order the schema reported its issues in.
 */
export function firstInvalidField(
  errors: VacancyFieldErrors,
): VacancyField | null {
  return VACANCY_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

/**
 * Normalizes one DOM salary string into something the request schema can judge:
 * blank becomes `null` (absent on the wire), a valid non-negative safe integer
 * becomes a number, and anything else keeps its text so the schema rejects that
 * exact field instead of a silent coercion.
 */
export function normalizeSalaryInput(value: string): number | null | string {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : trimmed;
}

/**
 * Validation authority: the same `createJobRequestSchema` the authenticated
 * `POST /jobs` client parses with. DOM strings are normalized first, so blank
 * optionals disappear and salary bounds become integers only when the contract
 * can accept them; every failure maps back to one Spanish field message.
 */
export function validateVacancyForm(
  values: VacancyFormValues,
): VacancyFieldErrors {
  const result = createJobRequestSchema.safeParse({
    title: values.title,
    description: values.description,
    work_mode: values.workMode,
    employment_type: values.employmentType,
    seniority: values.seniority,
    location: values.location,
    salary_min: normalizeSalaryInput(values.salaryMin),
    salary_max: normalizeSalaryInput(values.salaryMax),
    salary_currency: values.salaryCurrency,
  });

  if (result.success) return {};

  const errors: VacancyFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (!isVacancyField(field) || errors[field] !== undefined) continue;
    errors[field] =
      field === "salary_max" && issue.code === "custom"
        ? SALARY_RANGE_MESSAGE
        : FIELD_MESSAGES[field];
  }
  return errors;
}

/** What one save attempt decides: field errors, or the honest blocked notice. */
export type DraftSaveAttempt = {
  errors: VacancyFieldErrors;
  notice: string | null;
};

/**
 * Decides the outcome of a save attempt. A valid draft cannot be persisted
 * because no recruiter login exists, so it yields the blocker notice instead of
 * a save claim; an invalid draft yields its field errors first.
 */
export function attemptDraftSave(values: VacancyFormValues): DraftSaveAttempt {
  const errors = validateVacancyForm(values);
  if (Object.keys(errors).length > 0) {
    return { errors, notice: null };
  }
  return { errors: {}, notice: AUTH_REQUIRED_NOTICE };
}
