import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ActionErrorAlert } from "@/components/feedback/action-error-alert";
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
export function DraftSaveFeedback({ result, dirty, at, saved = false }: {
  result: DraftSaveResult | null; dirty: boolean; at?: string; saved?: boolean;
}) {
  if (!result) return null;
  if (result.ok) return (
    <div role="status" className="flex flex-col gap-2 text-sm text-muted-foreground">
      {dirty ? <p>Hay cambios sin guardar desde el último guardado confirmado.</p> : <Badge variant="success">Borrador guardado</Badge>}
      <p>Último guardado confirmado: <time dateTime={result.savedAt}>{formatSavedAt(result.savedAt)}</time> · Versión {result.version}</p>
    </div>
  );
  const message = messages[result.reason];
  const uncertain = ["server_error", "no_response", "unrecognized_response"].includes(result.reason);
  const description = uncertain
    ? saved
      ? "El borrador podría haberse actualizado. Puedes reintentar: no sobrescribiremos una versión más reciente; tus cambios siguen aquí."
      : "El borrador podría haberse guardado. Puedes reintentar con el mismo contenido: no se creará un duplicado."
    : message.description;
  const company = ["not_found", "company_inactive", "company_not_active"].includes(result.reason);
  const action = result.reason === "unauthenticated"
    ? <Link className={buttonVariants({ variant: "outline", className: "min-h-10" })} href="/empresa/login" target="_blank" rel="noopener noreferrer">Iniciar sesión</Link>
    : company ? <Link className={buttonVariants({ variant: "outline", className: "min-h-10" })} href="/empresa/configuracion" target="_blank" rel="noopener noreferrer">Crear empresa</Link> : undefined;
  return <ActionErrorAlert id="draft-save-error" title={message.title} description={description} action={action} reference={{ ...result.reference, at }} />;
}
