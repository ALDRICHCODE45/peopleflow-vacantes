import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import type { DraftSaveReason, DraftSaveResult } from "../actions";

export const DRAFT_SAVE_NOTICE =
  "Al pulsar Guardar borrador, se guardará en tu cuenta. No hay guardado automático: los cambios sin guardar se pierden al salir o recargar.";

const messages: Record<DraftSaveReason, string> = {
  unauthenticated:
    "Inicia sesión para guardar el borrador. Conserva esta página para no perder tus cambios.",
  forbidden: "Solo una cuenta de reclutador con permisos puede guardar borradores.",
  company_inactive: "Tu empresa está inactiva y no puede guardar borradores.",
  company_not_active: "Tu empresa debe estar activa para guardar borradores.",
  not_found:
    "No encontramos tu empresa o este borrador. Revisa la configuración de tu empresa.",
  idempotency_conflict:
    "El contenido cambió desde el primer intento. Esta clave de guardado ya se usó con otro contenido; vuelve al contenido original para reintentar sin duplicar el borrador. No recargues: podrías perder los cambios sin guardar.",
  version_conflict:
    "El borrador cambió en otro lugar. No sobrescribimos esos cambios. Conserva tu contenido: todavía no se puede reabrir ni recargar un borrador desde este editor.",
  precondition_required:
    "No se pudo comprobar la versión del borrador. Conserva tus cambios; no se guardaron de nuevo.",
  invalid_request:
    "No se pudo guardar el contenido. Revisa los campos e inténtalo de nuevo.",
  payload_too_large:
    "El borrador supera el tamaño permitido. Reduce el contenido antes de volver a guardar.",
  uncertain:
    "No pudimos confirmar el guardado. El borrador podría haberse guardado. Puedes reintentar explícitamente; para un borrador nuevo conservamos la misma clave para evitar duplicados. Si cambiaste el contenido, vuelve al original antes de reintentar.",
};

const savedAtFormat = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Human-readable confirmation time; the raw backend timestamp stays in `dateTime`. */
function formatSavedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : savedAtFormat.format(date);
}

export function DraftSaveFeedback({
  result,
  dirty,
}: {
  result: DraftSaveResult | null;
  dirty: boolean;
}) {
  if (!result) return null;
  if (result.ok) {
    return (
      <div role="status" className="flex flex-col gap-2 text-sm text-muted-foreground">
        {dirty ? (
          <p>Hay cambios sin guardar desde el último guardado confirmado.</p>
        ) : (
          <Badge variant="success">Borrador guardado</Badge>
        )}
        <p>
          Último guardado confirmado:{" "}
          <time dateTime={result.savedAt}>{formatSavedAt(result.savedAt)}</time> · Versión{" "}
          {result.version}
        </p>
      </div>
    );
  }
  return (
    <FieldError id="draft-save-error">
      {messages[result.reason]}{" "}
      {result.reason === "unauthenticated" ? (
        <Link className="underline" href="/empresa/login" target="_blank" rel="noopener noreferrer">
          Iniciar sesión en otra pestaña
        </Link>
      ) : null}
      {result.reason === "not_found" ? (
        <Link
          className="underline"
          href="/empresa/configuracion"
          target="_blank"
          rel="noopener noreferrer"
        >
          Configurar o crear empresa en otra pestaña
        </Link>
      ) : null}
    </FieldError>
  );
}
