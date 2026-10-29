import type { FailureReason } from "../model";
/** Product-safe causes only. Never reflect backend bodies or exception messages. */
export function failureTitle(reason: FailureReason): string {
  switch (reason) {
    case "unauthenticated": return "Tu sesión expiró";
    case "forbidden": return "No tienes permiso para esta acción";
    case "server_error": return "El servidor tuvo un problema";
    case "no_response": return "No hubo respuesta del servidor";
    case "unrecognized_response": return "No pudimos confirmar el resultado";
    case "version_conflict": case "profile_unconfirmed": case "process_finished": return "Esto cambió en otro lugar";
    case "not_found": return "El resultado ya no está disponible";
    default: return "No pudimos completar la acción";
  }
}
export function readConsequence(reason: FailureReason): string {
  switch (reason) {
    case "unauthenticated": return "El resultado no cambió. Inicia sesión de nuevo para consultarlo.";
    case "forbidden": return "El resultado no cambió. Solo el equipo de reclutamiento autorizado puede consultarlo.";
    case "not_found": return "No pudimos mostrar el resultado. Puede haber terminado su periodo de conservación; actualiza el tablero.";
    default: return "El resultado no cambió. Es seguro volver a intentar la lectura.";
  }
}
