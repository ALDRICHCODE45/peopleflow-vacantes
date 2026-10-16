import type { DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/actions";
import { conflictNotice as columnsConflict, invalidNotice as columnsInvalid, pipelineFailureNotice, type PipelineNotice } from "../stage-config/feedback";

export { recoveryLabels } from "../stage-config/feedback";
export type { PipelineNotice } from "../stage-config/feedback";
export const savedNotice: PipelineNotice = { tone: "success", title: "Subestados guardados", description: "Los subestados de esta vacante quedaron guardados.", text: "Guardado" };
export const conflictNotice: PipelineNotice = { ...columnsConflict, description: "Alguien guardó otra versión de estos subestados. Tus cambios siguen aquí. Si cargas la versión actual, reemplazará tus cambios." };
export const invalidNotice: PipelineNotice = { ...columnsInvalid, description: "Revisa los nombres de los subestados antes de guardar. Tus cambios siguen aquí." };
/** Share the cause mapping, recovery controls and account copy with cut 1. */
export function substatesFailureNotice(reason: DraftPipelineActionFailure["reason"]): PipelineNotice {
  const notice = pipelineFailureNotice(reason);
  if (reason === "version_conflict") return conflictNotice;
  if (reason === "validation_error" || reason === "invalid_request") return invalidNotice;
  if (notice.recovery === "check") return { ...notice, description: "No sabemos si se guardaron los subestados. Tus cambios siguen aquí. Comprueba la versión guardada antes de volver a guardar; todavía no es seguro reintentar." };
  if (reason === "forbidden") return { ...notice, description: "Solo la persona responsable del borrador o propietaria de la empresa puede guardar estos subestados. Tus cambios siguen aquí." };
  if (reason === "payload_too_large") return { ...notice, title: "El catálogo supera el tamaño permitido", description: "No se guardaron los subestados. Reduce el texto antes de volver a guardar; tus cambios siguen aquí." };
  return notice;
}
