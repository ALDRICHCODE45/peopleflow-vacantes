import { VACANCY_FIELDS, attemptDraftSave, firstInvalidField } from "./model";
import type {
  VacancyField,
  VacancyFieldErrors,
  VacancyFormValues,
} from "./model";

/**
 * Pure model of the four-step create-vacancy wizard: the step order, the
 * partition of the nine contract fields into steps, the scoped projection of the
 * schema errors, and the deterministic first invalid step.
 *
 * The contract rules stay in `model.ts`: this module never re-declares a bound,
 * a message, or a normalizer. It reads the schema authority through
 * `attemptDraftSave` and only decides which step owns the failure, so a step can
 * never disagree with the contract about what is valid.
 *
 * The module is pure: no hook, no DOM, no persistence.
 */

export const VACANCY_STEP_IDS = [
  "basic-information",
  "role-profile",
  "conditions-process",
  "review",
] as const;

export type VacancyStepId = (typeof VACANCY_STEP_IDS)[number];

export type VacancyStepMetadata = {
  id: VacancyStepId;
  /** User-facing Spanish title; UI copy stays Spanish. */
  title: string;
};

const STEP_TITLES: Record<VacancyStepId, string> = {
  "basic-information": "Información básica",
  "role-profile": "Perfil del puesto",
  "conditions-process": "Condiciones y proceso",
  review: "Revisar",
};

/** Every step in canonical wizard order. */
export const VACANCY_STEPS: readonly VacancyStepMetadata[] =
  VACANCY_STEP_IDS.map((id) => ({ id, title: STEP_TITLES[id] }));

export const stepTitle = (id: VacancyStepId): string => STEP_TITLES[id];

/** Zero-based position of a step; the wizard reads it from this one order. */
export const stepIndex = (id: VacancyStepId): number =>
  VACANCY_STEP_IDS.indexOf(id);

/** One-based position of a step, as the recruiter reads it. */
export const stepNumber = (id: VacancyStepId): number => stepIndex(id) + 1;

export const STEP_COUNT = VACANCY_STEP_IDS.length;

/** Stable DOM anchor of one step, used by the step shell and its focus target. */
export const stepAnchorId = (id: VacancyStepId): string =>
  `vacancy-step-${id}`;

/**
 * Which contract fields each step owns. Review owns none: it summarizes and
 * saves, so the final validation always routes back to a field-bearing step.
 */
export const STEP_FIELDS: Record<VacancyStepId, readonly VacancyField[]> = {
  "basic-information": [
    "title",
    "work_mode",
    "employment_type",
    "seniority",
    "location",
  ],
  "role-profile": ["description"],
  "conditions-process": ["salary_min", "salary_max", "salary_currency"],
  review: [],
};

export const fieldsForStep = (step: VacancyStepId): readonly VacancyField[] =>
  STEP_FIELDS[step];

/** The step that owns one contract field, resolved from the same partition. */
export function stepOfField(field: VacancyField): VacancyStepId {
  const step = VACANCY_STEP_IDS.find((candidate) =>
    STEP_FIELDS[candidate].includes(field),
  );
  if (step === undefined) {
    throw new Error(`Contract field ${field} belongs to no wizard step`);
  }
  return step;
}

/**
 * Projects the full error record onto one step, iterating the canonical field
 * order so the result never depends on the order the schema reported issues in.
 */
export function stepFieldErrors(
  step: VacancyStepId,
  errors: VacancyFieldErrors,
): VacancyFieldErrors {
  const owned = STEP_FIELDS[step];
  const scoped: VacancyFieldErrors = {};
  for (const field of VACANCY_FIELDS) {
    if (!owned.includes(field)) continue;
    const message = errors[field];
    if (message !== undefined) scoped[field] = message;
  }
  return scoped;
}

/** Whether a step currently owns any error. */
export function stepHasErrors(
  step: VacancyStepId,
  errors: VacancyFieldErrors,
): boolean {
  return firstInvalidField(stepFieldErrors(step, errors)) !== null;
}

/** The earliest step that owns an error, or null when the draft is valid. */
export function firstInvalidStep(
  errors: VacancyFieldErrors,
): VacancyStepId | null {
  return VACANCY_STEP_IDS.find((step) => stepHasErrors(step, errors)) ?? null;
}

/** Next step in wizard order, or null on the last one. */
export function nextStep(step: VacancyStepId): VacancyStepId | null {
  const index = stepIndex(step);
  return VACANCY_STEP_IDS[index + 1] ?? null;
}

/** Previous step in wizard order, or null on the first one. */
export function previousStep(step: VacancyStepId): VacancyStepId | null {
  const index = stepIndex(step);
  return index === 0 ? null : VACANCY_STEP_IDS[index - 1];
}

/**
 * Scoped validation of a single step: it runs the exact schema authority over
 * the whole draft and keeps only the failures this step owns. A step therefore
 * cannot advance while it owns an invalid field, and no rule is restated here.
 */
export function validateStepDraft(
  step: VacancyStepId,
  values: VacancyFormValues,
): VacancyFieldErrors {
  return stepFieldErrors(step, attemptDraftSave(values));
}
