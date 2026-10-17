import type { Failure, FailureReason } from "./model";
export type Notice = { tone: "success" | "error" | "info"; text: string };
export function boardErrorCopy(reason: FailureReason) {
  switch (reason) {
    case "board_too_large": return { title: "Hay demasiados candidatos", description: "El tablero supera el límite de 1.000 candidatos. No se modificó ninguna postulación." };
    case "vacancy_not_published": return { title: "Esta vacante no está publicada", description: "El tablero solo está disponible para vacantes publicadas. No se modificó ninguna postulación." };
    case "unauthenticated": return { title: "Tu sesión expiró", description: "Inicia sesión de nuevo para consultar el tablero." };
    case "forbidden": return { title: "No tienes permiso para esta acción", description: "Consulta el tablero con la cuenta responsable de la vacante." };
    default: return { title: "No pudimos cargar el tablero", description: "No se modificó ninguna postulación desde esta lectura. Es seguro volver a cargar." };
  }
}
export function moveErrorCopy(reason: FailureReason) {
  switch (reason) {
    case "stage_skip_not_allowed": return "No se movió: avanza solo a la siguiente etapa.";
    case "validation_error": return "No se movió: elige una etapa anterior o la siguiente.";
    case "vacancy_not_published": return "No se movió: esta vacante no está publicada.";
    case "unauthenticated": return "Tu sesión expiró. Inicia sesión para mover candidatos.";
    case "forbidden": return "No tienes permiso para mover este candidato.";
    default: return "No se movió el candidato. Revisa tu sesión y la etapa antes de intentar de nuevo.";
  }
}
export function needsReconciliation(failure: Failure): boolean {
  return ["uncertain", "no_response", "unrecognized_response", "version_conflict", "not_found", "server_error"].includes(failure.reason);
}
export function reconciliationCopy(reason: FailureReason, refreshed: boolean): string {
  if (!refreshed) return "No pudimos actualizar el tablero. No repetimos el movimiento; vuelve a cargar antes de mover candidatos.";
  return reason === "version_conflict"
    ? "Otro usuario movió a este candidato. Actualizamos el tablero."
    : "Actualizamos el tablero para comprobar el resultado. No repetimos el movimiento; revisa la etapa actual.";
}
