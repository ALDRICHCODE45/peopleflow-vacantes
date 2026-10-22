import { errorSchema, type IntakeFailure } from "./model";
export function intakeFailure(status?: number, value?: unknown): IntakeFailure {
  const parsed = errorSchema.safeParse(value);
  const envelope = parsed.success ? parsed.data : undefined;
  return { ok: false, reason: envelope?.code ?? (status === undefined ? "no_response" : "unrecognized_response"), reference: { status, code: envelope?.code }, fields: envelope?.fields, matches: envelope?.data?.matches, participationId: envelope?.data?.participation_id };
}
export const errorMessages: Record<string, string> = {
  possible_duplicates: "Encontramos posibles coincidencias. Elige cómo continuar.",
  candidate_already_in_process: "Este candidato ya está en el proceso.",
  process_finished: "El proceso finalizó. No puedes agregar candidatos.",
  vacancy_not_published: "Publica la vacante antes de agregar candidatos.",
  validation_error: "Revisa los datos marcados.",
  cv_content_mismatch: "El contenido del CV no coincide con su formato.",
  cv_unsupported_type: "Sube un PDF o un documento de Word (.docx).",
  cv_too_large: "El CV pesa más de 5 MB.",
  cv_storage_unavailable: "No pudimos guardar el CV. Intenta de nuevo.",
  cv_library_full: "La biblioteca de CV está llena.",
  invalid_request: "No pudimos enviar los datos. Revisa el formulario.",
  unauthenticated: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "No tienes permiso para agregar candidatos.",
  idempotency_conflict: "Este intento cambió. Revisa los datos antes de continuar.",
  no_response: "No hubo respuesta. Puedes reintentar sin duplicar el ingreso.",
  unrecognized_response: "No pudimos confirmar el resultado. Reintentar no duplica el ingreso.",
};
export function failureMessage(reason: string) { return errorMessages[reason] ?? "El servidor tuvo un problema. Reintentar no duplica el ingreso."; }
