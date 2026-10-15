import Link from "next/link";
import { ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { buttonVariants } from "@/components/ui/button";
import type { DraftSaveReason, DraftSaveResult } from "../actions";

export const DRAFT_SAVE_NOTICE =
  "Al pulsar Guardar borrador, se guardará en tu cuenta. No hay guardado automático: los cambios sin guardar se pierden al salir o recargar.";

const messages: Record<DraftSaveReason, { title: string; description: string }> = {
  unauthenticated: { title: "Tu sesión expiró", description: "Inicia sesión en otra pestaña para guardar. Tus cambios siguen en este formulario." },
  forbidden: { title: "No tienes permiso para esta acción", description: "Solo una cuenta de reclutador con permisos puede guardar borradores. Tus cambios siguen aquí." },
  company_inactive: { title: "Falta configurar tu empresa", description: "Tu empresa está inactiva y no puede guardar borradores. Revisa su configuración; tus cambios siguen aquí." },
  company_not_active: { title: "Falta configurar tu empresa", description: "Tu empresa debe estar activa para guardar. Revisa su configuración; tus cambios siguen aquí." },
  not_found: { title: "Falta configurar tu empresa", description: "No encontramos tu empresa o este borrador. Revisa la configuración sin cerrar este formulario." },
  idempotency_conflict: { title: "Esto cambió en otro lugar", description: "El contenido cambió desde el primer intento. Vuelve al contenido original para reintentar sin duplicar; no recargues porque perderías lo capturado." },
  version_conflict: { title: "Esto cambió en otro lugar", description: "No sobrescribimos los cambios de otro guardado. Conserva tu contenido aquí: este editor todavía no permite reabrir el borrador." },
  precondition_required: { title: "No se pudo comprobar la versión", description: "Tus cambios siguen aquí y no se guardaron de nuevo. Conserva el contenido antes de salir." },
  invalid_request: { title: "Revisa los datos del borrador", description: "El contenido no se guardó. Revisa los campos e inténtalo de nuevo." },
  payload_too_large: { title: "El borrador supera el tamaño permitido", description: "El contenido no se guardó. Reduce el texto antes de volver a guardar." },
  server_error: { title: "El servidor tuvo un problema", description: "No se confirmó el guardado." },
  no_response: { title: "No hubo respuesta del servidor", description: "No se confirmó el guardado." },
  unrecognized_response: { title: "No pudimos confirmar el resultado", description: "No se confirmó el guardado." },
};
const savedAtFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
function formatSavedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : savedAtFormat.format(date);
}
function isUncertain(reason: DraftSaveReason) {
  return ["server_error", "no_response", "unrecognized_response"].includes(reason);
}

export function notifyDraftSaveResult(result: DraftSaveResult, saved: boolean, at: string) {
  if (result.ok) {
    notifyActionResult({ key: "draft-save", type: "success", title: saved ? "Cambios guardados" : "Borrador guardado", description: `Se guardó la versión ${result.version} en tu cuenta.` });
    return;
  }
  const message = messages[result.reason];
  const description = isUncertain(result.reason)
    ? saved
      ? "El borrador podría haberse actualizado. Puedes reintentar: no sobrescribiremos una versión más reciente; tus cambios siguen aquí."
      : "El borrador podría haberse guardado. Puedes reintentar con el mismo contenido: no se creará un duplicado."
    : message.description;
  notifyActionResult({ key: "draft-save", type: "error", title: message.title, description, reference: { ...result.reference, at } });
}

export function DraftSaveFeedback({ result, dirty }: {
  result: DraftSaveResult | null; dirty: boolean;
}) {
  if (!result) return null;
  // One line only: the slot below the save button keeps a fixed height.
  if (result.ok) return dirty
    ? <ActionStatus id="draft-save-status" tone="info" text={`Cambios sin guardar · última versión guardada: ${result.version}`} />
    : <ActionStatus id="draft-save-status" tone="success" text={`Guardado · versión ${result.version} · ${formatSavedAt(result.savedAt)}`} />;
  const company = ["not_found", "company_inactive", "company_not_active"].includes(result.reason);
  const action = result.reason === "unauthenticated"
    ? <Link className={buttonVariants({ variant: "outline", className: "min-h-10" })} href="/empresa/login" target="_blank" rel="noopener noreferrer">Iniciar sesión</Link>
    : company ? <Link className={buttonVariants({ variant: "outline", className: "min-h-10" })} href="/empresa/configuracion" target="_blank" rel="noopener noreferrer">Crear empresa</Link> : undefined;
  return <ActionStatus id="draft-save-status" tone="error" text={isUncertain(result.reason) ? "Resultado sin confirmar · ver aviso" : "No se guardó · ver aviso"} action={action} />;
}
