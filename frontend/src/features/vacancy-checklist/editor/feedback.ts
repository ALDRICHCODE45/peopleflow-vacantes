import type { FailureReason, ValidationField } from "../model";
export type Notice = { tone: "success" | "error" | "info"; title: string; description?: string; recovery?: "reload" | "check" };
export function failureNotice(reason: FailureReason): Notice {
  switch (reason) {
    case "validation_error": return { tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Corrige los criterios señalados." };
    case "version_conflict": return { tone: "error", title: "Esto cambió en otro lugar", description: "Tus cambios siguen aquí. Carga la versión actual para revisarla antes de guardar.", recovery: "reload" };
    case "precondition_required": return { tone: "error", title: "Necesitamos actualizar el checklist", description: "Tus cambios siguen aquí. Carga la versión actual antes de guardar.", recovery: "reload" };
    case "process_finished": return { tone: "info", title: "El proceso ya terminó; el checklist ya no se puede cambiar" };
    case "unauthenticated": return { tone: "error", title: "Tu sesión expiró", description: "Tus cambios siguen aquí. Inicia sesión de nuevo." };
    case "forbidden": return { tone: "error", title: "No tienes permiso para esta acción", description: "Tus cambios siguen aquí. Consulta con quien administra tu empresa." };
    case "not_found": return { tone: "error", title: "No encontramos esta vacante", description: "Tus cambios siguen aquí. Verifica que siga disponible." };
    case "invalid_request": return { tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Revisa los criterios antes de guardar." };
    case "no_response": return { tone: "error", title: "No hubo respuesta del servidor", description: "Tus cambios siguen aquí. Comprueba si se guardaron antes de volver a guardar; no se repetirá el envío.", recovery: "check" };
    case "server_error": return { tone: "error", title: "El servidor tuvo un problema", description: "Tus cambios siguen aquí. Comprueba si se guardaron antes de volver a guardar; no se repetirá el envío.", recovery: "check" };
    default: return { tone: "error", title: "No pudimos confirmar el resultado", description: "Tus cambios siguen aquí. Comprueba si se guardaron antes de volver a guardar; no se repetirá el envío.", recovery: "check" };
  }
}
export function fieldErrors(fields: ValidationField[]) {
  const rows: Record<number, string> = {}; let reminders: string | undefined;
  for (const issue of fields) {
    const match = /^criteria\[(\d+)\]/u.exec(issue.field);
    if (match) rows[Number(match[1])] = issue.code === "duplicate" ? "Este criterio está repetido; quítalo o cámbialo" : issue.field.includes("question_id") ? "La pregunta ya no existe; quítala o cámbiala" : issue.field.includes("accepted_option_ids") ? "La respuesta ya no existe; quítala o cámbiala" : "Revisa este criterio";
    if (issue.field.startsWith("reminder_stage_ids")) reminders = "La etapa ya no existe; actualiza las columnas";
  }
  return { rows, reminders };
}
