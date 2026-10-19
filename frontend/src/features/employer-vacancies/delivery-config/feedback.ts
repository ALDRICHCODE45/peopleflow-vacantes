import type { DeliveryActionFailure } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { formatPublishedSaveMissing } from "@/features/jobs/drafts/pipeline/publication-model";
import { conflictNotice as columnsConflict, invalidNotice as columnsInvalid, pipelineFailureNotice, type PipelineNotice } from "../stage-config/feedback";

export { recoveryLabels } from "../stage-config/feedback";
export type { PipelineNotice } from "../stage-config/feedback";
export const savedNotice: PipelineNotice = { tone: "success", title: "Entrega guardada", description: "Los datos de entrega de esta vacante quedaron guardados.", text: "Guardado" };
export const conflictNotice: PipelineNotice = { ...columnsConflict, description: "Alguien guardó otra versión de la entrega. Tus cambios siguen aquí. Si cargas la versión actual, reemplazará tus cambios." };
export const invalidNotice: PipelineNotice = { ...columnsInvalid, description: "Revisa los datos de entrega antes de guardar. Tus cambios siguen aquí." };
/** Reuse the cut-1 cause mapping, replacing only resource-specific copy. */
export function deliveryFailureNotice(failure: DeliveryActionFailure): PipelineNotice {
  if (failure.reason === "publication_incomplete") return {
    tone: "error", title: "La vacante está publicada", description: formatPublishedSaveMissing(failure.missing),
    text: "No se guardó · faltan datos para una vacante publicada",
  };
  if (failure.reason === "delivery_fulfilled") return { tone: "info", title: "La entrega ya se cumplió", description: "Su configuración ya no se puede cambiar. Carga la versión actual para ver el resultado.", text: "Entrega cumplida · carga el resultado", recovery: "reload" };
  if (failure.reason === "fulfillment_confirmation_required") return { tone: "info", title: "Confirma el cumplimiento", description: "Revisa los candidatos antes de confirmar. Tus cambios siguen aquí.", text: "Confirma antes de guardar" };
  if (failure.reason === "vacancy_not_published") return { tone: "info", title: "La vacante no está publicada", text: "Publica la vacante para ver su entrega" };
  const { reason } = failure;
  const notice = pipelineFailureNotice(reason);
  if (reason === "version_conflict") return conflictNotice;
  if (reason === "validation_error" || reason === "invalid_request" || reason === "non_business_date") return invalidNotice;
  if (notice.recovery === "check") return { ...notice, description: "No sabemos si se guardó la entrega. Tus cambios siguen aquí. Comprueba la versión guardada antes de volver a guardar; todavía no es seguro reintentar." };
  if (reason === "forbidden") return { ...notice, description: "Solo la persona responsable del borrador o propietaria de la empresa puede guardar la entrega. Tus cambios siguen aquí." };
  if (reason === "payload_too_large") return { ...notice, title: "La entrega supera el tamaño permitido", description: "No se guardó la entrega. Revisa los datos antes de volver a guardar; tus cambios siguen aquí." };
  return notice;
}
