import type { DiscardBody, DiscardReason } from "./model";

export const discardCatalog = [
  { group: "recruiter", label: "Decisión de la empresa", reasons: [
    { key: "requirements_not_met", label: "No cumple requisitos" },
    { key: "profile_mismatch", label: "Perfil no adecuado" },
    { key: "salary_expectation", label: "Expectativa salarial" },
    { key: "other_candidate_selected", label: "Seleccionamos a otra persona" },
    { key: "other", label: "Otro" },
  ] },
  { group: "candidate", label: "Decisión del candidato", reasons: [
    { key: "accepted_other_offer", label: "Aceptó otra oferta" },
    { key: "no_longer_interested", label: "Ya no le interesa" },
    { key: "unresponsive", label: "Sin respuesta del candidato" },
    { key: "other", label: "Otro" },
  ] },
] as const;
export function discardReasonLabel(reason: DiscardReason): string {
  return discardCatalog.find(group => group.group === reason.group)!.reasons.find(entry => entry.key === reason.key)!.label;
}
export function discardGroupLabel(reason: DiscardReason): string {
  return discardCatalog.find(group => group.group === reason.group)!.label;
}
/** Contract §13.6.1: no NFC, whitespace collapsing or UTF-16 length limits. */
export function validateDiscardText(raw: string, limit: number, required = false) {
  const value = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  const count = Array.from(value).length;
  const error = /[^\P{Cc}\n\t]/u.test(value) ? "control_character" : count > limit ? "too_long" : required && !count ? "required" : null;
  return { value, count, error };
}
export function buildDiscardBody(reason: DiscardReason, comment: string, message: string, placementExit = false): DiscardBody {
  const internal = validateDiscardText(comment, 1000, reason.key === "other");
  const candidate = validateDiscardText(message, 500);
  if (internal.error || candidate.error) throw new Error("Invalid discard text");
  return { reason, ...(internal.value ? { comment: internal.value } : {}), ...(candidate.value ? { candidate_message: candidate.value } : {}), ...(placementExit ? { confirm_placement_exit: true } : {}) };
}
