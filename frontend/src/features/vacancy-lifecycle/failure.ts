import "server-only";

import { publicationIncompleteFailure } from "@/features/jobs/drafts/pipeline/failure";
import { conflictSchema, type LifecycleFailure } from "./client";
import type { Lifecycle } from "./model";

const messages = {
  unauthenticated: "Inicia sesión para continuar.",
  forbidden: "No tienes permiso para cambiar el estado de esta vacante.",
  not_found: "No encontramos esta vacante o ya no tienes acceso.",
  invalid_request: "No pudimos enviar la acción. Recarga la vacante y vuelve a intentarlo.",
  lifecycle_transition_invalid: "El estado de la vacante cambió. Revisa las acciones disponibles.",
  process_finished: "El proceso ya finalizó. Recarga la vacante para ver su estado actual.",
  version_conflict: "La vacante cambió. Recarga su estado antes de elegir otra acción.",
  precondition_required: "Recarga el estado de la vacante antes de continuar.",
  publication_incomplete: "Te falta para publicar",
  no_response: "No pudimos confirmar si se aplicó la acción. Consulta el estado antes de volver a intentarlo.",
  server_error: "No pudimos confirmar el resultado. Consulta el estado de la vacante.",
  unrecognized_response: "No pudimos interpretar la respuesta. Consulta el estado de la vacante.",
} as const;
export type LifecycleActionFailure = {
  ok: false;
  reason: keyof typeof messages;
  message: string;
  reference: { status?: number; code?: string };
  lifecycle?: Lifecycle;
  missing?: string[];
  reload?: boolean;
  uncertain?: boolean;
};
export function mapLifecycleFailure(input: LifecycleFailure): LifecycleActionFailure {
  const { error, envelope } = input;
  const incomplete = publicationIncompleteFailure(input);
  if (incomplete) return { ...incomplete, message: messages.publication_incomplete };
  const status = error.status;
  const conflict = conflictSchema.safeParse(envelope);
  let reason: LifecycleActionFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request" || status === 400) reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status === 412) reason = "version_conflict";
  else if (status === 428) reason = "precondition_required";
  else if (status === 409 && conflict.success) reason = conflict.data.code;
  else if (status !== undefined && status >= 500) reason = "server_error";
  return {
    ok: false, reason, message: messages[reason],
    reference: { ...(status !== undefined ? { status } : {}), ...(envelope?.code === reason ? { code: reason } : {}) },
    ...(status === 409 && conflict.success ? { lifecycle: conflict.data.data.lifecycle } : {}),
    ...(["version_conflict", "precondition_required"].includes(reason) ? { reload: true } : {}),
    ...(["no_response", "server_error", "unrecognized_response"].includes(reason) ? { uncertain: true } : {}),
  };
}
