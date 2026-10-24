import { plural } from "@/features/employer-vacancies/plural";
import type { PipelineImpact } from "@/features/jobs/drafts/pipeline/client";
import type { DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/actions";

export type PipelineNotice = {
  tone: "success" | "info" | "error";
  title: string;
  description?: string;
  text: string;
  recovery?: "reload" | "check";
  reviewImpact?: boolean;
  link?: { href: string; title: string };
};
export const recoveryLabels = { reload: "Cargar versión actual", check: "Comprobar" } as const;
export const savedNotice: PipelineNotice = {
  tone: "success", title: "Pipeline guardado",
  description: "Las columnas de esta vacante quedaron guardadas.", text: "Guardado",
};
export const conflictNotice: PipelineNotice = {
  tone: "error", title: "Esto cambió en otro lugar",
  description: "Alguien guardó otra versión de estas columnas. Tus cambios siguen aquí. Si cargas la versión actual, reemplazará tus cambios.",
  text: "Tus cambios siguen aquí · ver aviso", recovery: "reload",
};
const validation: PipelineNotice = {
  tone: "error", title: "Revisa los datos marcados",
  description: "Revisa los nombres de las columnas antes de guardar. Tus cambios siguen aquí.", text: "No se guardó · revisa los datos",
};
export const invalidNotice = validation;
const company: PipelineNotice = {
  tone: "error", title: "Falta configurar tu empresa",
  description: "Tu empresa debe estar activa para guardar. Tus cambios siguen aquí; revisa su configuración sin cerrar este formulario.",
  text: "No se guardó · revisa tu empresa", link: { href: "/empresa/configuracion", title: "Revisar empresa" },
};
const uncertain = (title: string): PipelineNotice => ({
  tone: "error", title,
  description: "No sabemos si se guardó el pipeline. Tus cambios siguen aquí. Comprueba la versión guardada antes de volver a guardar; todavía no es seguro reintentar.",
  text: "Guardado sin confirmar · comprueba la versión", recovery: "check",
});
const failures: Record<DraftPipelineActionFailure["reason"], PipelineNotice> = {
  process_finished: { tone: "info", title: "Proceso finalizado", text: "El proceso de esta vacante finalizó. La configuración está en solo lectura." },
  version_conflict: conflictNotice,
  stage_change_requires_empty_pipeline: conflictNotice,
  stage_occupied: {
    tone: "error", title: "La columna tiene candidatos",
    description: "Mueve a los candidatos antes de quitar la columna.", text: "No se guardó · revisa el tablero",
  },
  impact_confirmation_required: {
    tone: "error", title: "Revisa el impacto de nuevo",
    description: "El proceso cambió. Tus cambios siguen aquí; revisa el impacto antes de confirmar otra vez.",
    text: "No se guardó · revisa el impacto", reviewImpact: true,
  },
  no_response: uncertain("No hubo respuesta del servidor"),
  server_error: uncertain("El servidor tuvo un problema"),
  unrecognized_response: uncertain("No pudimos confirmar el resultado"),
  precondition_required: uncertain("No pudimos confirmar el resultado"),
  non_business_date: validation,
  cutoff_stage_in_use: {
    tone: "error", title: "No puedes quitar la columna de corte",
    description: "Esa columna es el corte de entrega. Cambia la columna de corte en Entrega antes de quitarla.",
    text: "No se guardó · cambia el corte en Entrega",
  },
  validation_error: validation,
  invalid_request: validation,
  unauthenticated: {
    tone: "error", title: "Tu sesión expiró", description: "Inicia sesión en otra pestaña para guardar. Tus cambios siguen en este formulario.",
    text: "No se guardó · inicia sesión", link: { href: "/empresa/login", title: "Iniciar sesión" },
  },
  forbidden: {
    tone: "error", title: "No tienes permiso para esta acción",
    description: "Solo la persona responsable del borrador o propietaria de la empresa puede guardar estas columnas. Tus cambios siguen aquí.", text: "No se guardó · revisa tu cuenta",
  },
  not_found: {
    tone: "error", title: "No encontramos este borrador",
    description: "Puede que ya no exista o que no esté disponible para tu cuenta. Tus cambios siguen aquí; revisa los borradores a los que tienes acceso.", text: "No se guardó · borrador no disponible",
  },
  company_inactive: company,
  company_not_active: company,
  payload_too_large: {
    tone: "error", title: "El pipeline supera el tamaño permitido",
    description: "No se guardaron las columnas. Reduce el texto antes de volver a guardar; tus cambios siguen aquí.", text: "No se guardó · reduce el texto",
  },
};
/** Compare affected participation/stage identities, not totals or candidate display names. */
function impactKey(impact: PipelineImpact) {
  return JSON.stringify([
    impact.not_applicable.map(entry => `${entry.participation_id}:${entry.stage_id}`).sort(),
    impact.recovery_reassigned.map(entry => `${entry.participation_id}:${entry.retired_stage_id}:${entry.default_stage_id}`).sort(),
  ]);
}
export function appliedImpactNotice(applied: PipelineImpact, preview?: PipelineImpact | null): PipelineNotice {
  const count = new Set(applied.not_applicable.map(entry => entry.participation_id)).size;
  const recoveryCount = new Set(applied.recovery_reassigned.map(entry => entry.participation_id)).size;
  const summary = [
    count ? `${plural(count, "candidato quedó", "candidatos quedaron")} con "No aplica" en columnas nuevas o movidas.` : "",
    recoveryCount ? `${plural(recoveryCount, "candidato elegirá", "candidatos elegirán")} columna al recuperarse.` : "",
  ].filter(Boolean).join(" ");
  const changed = preview && impactKey(applied) !== impactKey(preview);
  const description = changed ? `El impacto cambió desde la vista previa: ${summary || "ningún candidato recibió cambios de proceso."}` : summary;
  return { tone: "success", title: "Columnas guardadas.", text: description || "Guardado", description: description || undefined };
}
export function pipelineFailureNotice(reason: DraftPipelineActionFailure["reason"]): PipelineNotice {
  return failures[reason] ?? failures.unrecognized_response;
}
