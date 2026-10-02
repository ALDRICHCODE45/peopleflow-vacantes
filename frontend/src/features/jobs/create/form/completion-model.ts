import type { VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";
import { VACANCY_FORM_SECTIONS } from "./section-metadata";
import type { VacancySectionId } from "./section-metadata";

/**
 * Observable completion of the create-vacancy form: which sections already hold
 * content the recruiter can see. It never imports the request schema, the API
 * client, or the transport, so it cannot report validity, save readiness,
 * persistence, or remote sync; every predicate reads the current state, which
 * keeps the summary a pure recomputation.
 */
export type VacancyCompletionSection = {
  id: VacancySectionId;
  title: string;
  /** Whether the section currently holds any meaningful content. */
  complete: boolean;
};

export type VacancyCompletionSummary = {
  /** Canonical sections, in `VACANCY_FORM_SECTIONS` order. */
  sections: readonly VacancyCompletionSection[];
  completed: number;
  total: number;
};

/** A section holds content when its own state carries a non-blank value. */
const filled = (value: string): boolean => value.trim() !== "";

type ContentPredicate = (
  values: VacancyFormValues,
  prototype: VacancyPrototypeValues,
) => boolean;

/** One content predicate per canonical section. */
const SECTION_CONTENT: Record<VacancySectionId, ContentPredicate> = {
  // The trimmed title plus the three chosen enums; a location alone is not it.
  "basic-information": (values) =>
    filled(values.title) && values.workMode !== "" && values.employmentType !== "" && values.seniority !== "",
  // Either bound is content; the rendered default currency is not.
  compensation: (values) => filled(values.salaryMin) || filled(values.salaryMax),
  // The derived contract description owns this section; the optional
  // requirement lists never gate it.
  "description-requirements": (values) => filled(values.description),
  strategy: (_values, prototype) =>
    filled(prototype.department) ||
    prototype.skills.length > 0 ||
    prototype.languages.some((language) => filled(language.language)) ||
    filled(prototype.closingDate),
  "benefits-pay-frequency": (_values, prototype) =>
    prototype.benefits.length > 0 || prototype.payFrequency !== "",
  screening: (_values, prototype) =>
    prototype.screeningQuestions.some((question) => filled(question.prompt)),
};

/** Observable content summary of the current form state. */
export function vacancyCompletion(
  values: VacancyFormValues,
  prototype: VacancyPrototypeValues,
): VacancyCompletionSummary {
  const sections = VACANCY_FORM_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    complete: SECTION_CONTENT[section.id](values, prototype),
  }));
  return {
    sections,
    completed: sections.filter((section) => section.complete).length,
    total: sections.length,
  };
}
