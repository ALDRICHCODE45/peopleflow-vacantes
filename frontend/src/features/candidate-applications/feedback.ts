import type { Failure } from "./model";
export function uncertain(failure: Failure) { return ["no_response", "server_error", "unrecognized_response"].includes(failure.reason); }
export function failureCopy(failure: Failure) {
  const reason = failure.reason;
  if (reason === "applicant_country_required") return { title: "Completa tu país de residencia", description: "No se envió la postulación. Conservamos tus datos; agrega tu país en tu perfil." };
  if (reason === "applicant_country_not_allowed") return { title: "Tu país no está permitido", description: "No se envió la postulación. Conservamos tus datos; revisa los países aceptados por esta vacante." };
  if (reason === "unauthenticated") return { title: "Tu sesión expiró", description: "Tus datos siguen aquí. Ingresa como candidato para continuar." };
  if (reason === "wrong_role") return { title: "Esta cuenta es de empresa", description: "Una cuenta tiene un solo rol. Para usar otra área necesitas una cuenta con otro email." };
  if (reason === "forbidden") return { title: "No tienes permiso para esta acción", description: "Para postularte necesitas una cuenta de candidato." };
  if (reason === "questionnaire_changed") return { title: "Las preguntas cambiaron", description: "Conservamos tu CV. Revisa las preguntas antes de enviar." };
  if (reason === "invalid_answers") return { title: "Revisa los datos marcados", description: "No se envió la postulación. Corrige las respuestas señaladas." };
  if (reason === "cv_unavailable") return { title: "Ese CV ya no está disponible", description: "No se envió la postulación. Elige otro CV de tu biblioteca." };
  if (reason === "already_applied") return { title: "Ya te postulaste a esta vacante", description: "Puedes consultar tu postulación en Mis postulaciones." };
  if (reason === "not_found") return { title: "Esta vacante ya no está disponible", description: "Explora otras vacantes para continuar." };
  if (uncertain(failure)) return { title: reason === "no_response" ? "No hubo respuesta del servidor" : reason === "server_error" ? "El servidor tuvo un problema" : "No pudimos confirmar el resultado", description: "Conservamos tus datos. Puedes reintentar de forma segura sin duplicar la postulación." };
  return { title: "No se pudo enviar la postulación", description: "Conservamos tus datos. Revisa la vacante antes de intentar de nuevo." };
}
