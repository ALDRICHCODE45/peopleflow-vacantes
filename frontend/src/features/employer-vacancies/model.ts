/** Display vocabularies shared by the real vacancy portfolio and dashboard. */
export const EMPLOYER_VACANCY_STATES = ["active", "paused", "closed"] as const;
export type EmployerVacancyState = (typeof EMPLOYER_VACANCY_STATES)[number];
export const EMPLOYER_WORK_MODES = ["onsite", "remote", "hybrid"] as const;
export type EmployerWorkMode = (typeof EMPLOYER_WORK_MODES)[number];
export const EMPLOYER_EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export type EmployerEmploymentType = (typeof EMPLOYER_EMPLOYMENT_TYPES)[number];
export const VACANCY_PIPELINE_STAGES = ["submitted", "in_review", "hired", "rejected"] as const;
export type VacancyPipelineStage = (typeof VACANCY_PIPELINE_STAGES)[number];
export const EMPLOYER_VACANCY_STATE_LABELS: Readonly<Record<EmployerVacancyState, string>> = Object.freeze({ active: "Activa", paused: "Pausada", closed: "Cerrada" });
export const EMPLOYER_WORK_MODE_LABELS: Readonly<Record<EmployerWorkMode, string>> = Object.freeze({ onsite: "Presencial", remote: "Remoto", hybrid: "Híbrido" });
export const EMPLOYER_EMPLOYMENT_TYPE_LABELS: Readonly<Record<EmployerEmploymentType, string>> = Object.freeze({ full_time: "Tiempo completo", part_time: "Medio tiempo", contract: "Contrato", internship: "Pasantía" });

/** Canonical route for a backend vacancy id. */
export function vacancyPipelineHref(jobId: string): string {
  return `/empresa/vacantes/${jobId}/pipeline`;
}

/** Pure menu contract; portal rendering is verified in the browser. */
export function portfolioRowActions(id: string, status: "draft" | "published") {
  return [
    ...(status === "draft" ? [
      { label: "Continuar editando", kind: "edit" as const, href: `/empresa/vacantes/borradores/${id}` },
      { label: "Publicar", kind: "publish" as const, href: undefined },
    ] : []),
    { label: "Ver pipeline", kind: "pipeline" as const, href: vacancyPipelineHref(id) },
  ];
}
