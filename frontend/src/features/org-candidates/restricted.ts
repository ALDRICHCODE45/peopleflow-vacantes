/** The owner restricted the talent base (talent-base-visibility v1, D3): explained, never retried. */
export const TALENT_BASE_RESTRICTED = {
  title: "Base de talento restringida",
  description: "El owner limitó el acceso a la Base de talento. Sigues viendo a los candidatos de tus vacantes desde su tablero.",
} as const;

export function isTalentBaseRestricted(reference: { code?: string } | undefined): boolean {
  return reference?.code === "talent_base_restricted";
}
