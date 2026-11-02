import type { SavedJobsFailure } from "./model";
/** Reviewed product copy only; backend error messages never enter the UI. */
export function savedJobErrorCopy(error: SavedJobsFailure, removing = false) {
  switch (error.reason) {
    case "saved_jobs_limit": return { title: "Llegaste al límite de 200 vacantes guardadas", description: "Quita alguna que ya no te interese para guardar otra." };
    case "not_found": case "job_unavailable": return { title: "Esta vacante ya no está disponible" };
    case "validation_error": return { title: "Revisa los datos marcados", description: "No cambiamos tus vacantes guardadas." };
    case "unauthenticated": return { title: "Tu sesión expiró", description: "Inicia sesión para continuar." };
    case "forbidden": return { title: "No tienes permiso para esta acción", description: "Solo las cuentas de candidato pueden guardar vacantes." };
    case "unrecognized_response": return { title: "No pudimos confirmar el resultado", description: "Puedes reintentar: no se duplicará.", retry: true };
    default: return { title: removing ? "No se pudo quitar la vacante" : "No se pudo guardar la vacante", description: "Puedes reintentar: no se duplicará.", retry: true };
  }
}
