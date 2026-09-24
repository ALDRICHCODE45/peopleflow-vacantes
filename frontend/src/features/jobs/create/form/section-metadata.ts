/**
 * Canonical metadata for the create-vacancy form sections: order, stable anchor,
 * and Spanish title in one place. Navigation must read it too.
 */

export const VACANCY_SECTION_IDS = [
  "basic-information",
  "compensation",
  "description-requirements",
  "strategy",
  "benefits-pay-frequency",
  "screening",
] as const;

export type VacancySectionId = (typeof VACANCY_SECTION_IDS)[number];

export type VacancySectionMetadata = {
  id: VacancySectionId;
  /** User-facing Spanish title; UI copy stays Spanish. */
  title: string;
};

const SECTION_TITLES: Record<VacancySectionId, string> = {
  "basic-information": "Información básica",
  compensation: "Compensación",
  "description-requirements": "Descripción y requisitos",
  strategy: "Estrategia de contratación",
  "benefits-pay-frequency": "Beneficios y frecuencia de pago",
  screening: "Preguntas de filtro",
};

/** Every section in canonical render order. */
export const VACANCY_FORM_SECTIONS: readonly VacancySectionMetadata[] =
  VACANCY_SECTION_IDS.map((id) => ({ id, title: SECTION_TITLES[id] }));

export const sectionTitle = (id: VacancySectionId): string => SECTION_TITLES[id];

/** Stable DOM anchor of one section, used by in-page navigation. */
export const sectionAnchorId = (id: VacancySectionId): string =>
  `vacancy-section-${id}`;
