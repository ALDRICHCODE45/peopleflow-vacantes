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

/** Public page of a published vacancy (the candidate side's route). */
export function vacancyPublicHref(jobId: string): string {
  return `/vacantes/${jobId}`;
}

/** Editor route for a draft and for a vacancy already published (same editor). */
export function vacancyEditorHref(id: string): string {
  return `/empresa/vacantes/borradores/${id}`;
}

/**
 * A public page exists only for a published vacancy that is not a private replacement: never for a draft,
 * a paused or a closed one. An older backend without `visibility` means public.
 */
export function hasPublicPage(vacancy: { status: "draft" | "published" | "paused" | "closed"; visibility?: "public" | "private" | null | undefined }): boolean {
  return vacancy.status === "published" && vacancy.visibility !== "private";
}

/** The editor stays reachable while the vacancy is live (published or paused), never once it is closed. */
export function isEditablePublication(status: "draft" | "published" | "paused" | "closed"): boolean {
  return status === "published" || status === "paused";
}

/**
 * Pure menu contract; portal rendering is verified in the browser. `editable` adds «Editar publicación» (a live vacancy's
 * way back to the editor) and `publicPage` adds «Ver página pública» (opens in a new tab); «Compartir» is a submenu the
 * list renders itself, under the same `publicPage` condition.
 */
export function portfolioRowActions(id: string, status: "draft" | "published", options: { editable?: boolean; publicPage?: boolean } = {}) {
  return [
    ...(status === "draft" ? [
      { label: "Continuar editando", kind: "edit" as const, href: vacancyEditorHref(id) },
      { label: "Publicar", kind: "publish" as const, href: undefined },
    ] : []),
    ...(status === "published" && options.editable ? [{ label: "Editar publicación", kind: "edit" as const, href: vacancyEditorHref(id) }] : []),
    { label: "Ver pipeline", kind: "pipeline" as const, href: vacancyPipelineHref(id) },
    ...(status === "published" && options.publicPage ? [{ label: "Ver página pública", kind: "public" as const, href: vacancyPublicHref(id) }] : []),
  ];
}
