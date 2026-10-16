import type { DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/actions";
import { conflictNotice as columnsConflict, invalidNotice as columnsInvalid, pipelineFailureNotice, type PipelineNotice } from "../stage-config/feedback";

export { recoveryLabels } from "../stage-config/feedback";
export type { PipelineNotice } from "../stage-config/feedback";
export const savedNotice: PipelineNotice = { tone: "success", title: "Entrega guardada", description: "Los datos de entrega de esta vacante quedaron guardados.", text: "Guardado" };
export const conflictNotice: PipelineNotice = { ...columnsConflict, description: "Alguien guardó otra versión de la entrega. Tus cambios siguen aquí. Si cargas la versión actual, reemplazará tus cambios." };
export const invalidNotice: PipelineNotice = { ...columnsInvalid, description: "Revisa los datos de entrega antes de guardar. Tus cambios siguen aquí." };
/** Reuse the cut-1 cause mapping, replacing only resource-specific copy. */
export function deliveryFailureNotice(reason: DraftPipelineActionFailure["reason"]): PipelineNotice {
  const notice = pipelineFailureNotice(reason);
  if (reason === "version_conflict") return conflictNotice;
  if (reason === "validation_error" || reason === "invalid_request" || reason === "non_business_date") return invalidNotice;
  if (notice.recovery === "check") return { ...notice, description: "No sabemos si se guardó la entrega. Tus cambios siguen aquí. Comprueba la versión guardada antes de volver a guardar; todavía no es seguro reintentar." };
  if (reason === "forbidden") return { ...notice, description: "Solo la persona responsable del borrador o propietaria de la empresa puede guardar la entrega. Tus cambios siguen aquí." };
  if (reason === "payload_too_large") return { ...notice, title: "La entrega supera el tamaño permitido", description: "No se guardó la entrega. Revisa los datos antes de volver a guardar; tus cambios siguen aquí." };
  return notice;
}
