import { z } from "zod";
import { documentFormatSchema, formatDescriptorSchema, type DocumentFormat } from "./model";

/**
 * `placement-vacancy-documents-v1` «Error codes» → Mexican Spanish (tú) copy. Pure (no `server-only`): the backend `error` text never
 * crosses this boundary, only the allowlisted classification, the per-code `data` and the copy built here. No limit is written in the
 * messages: sizes, counts and formats come from `data` (which the backend takes from the same constants as `limits`).
 */
export type DocumentFailureInput = { error: { kind: string; status?: number }; envelope?: unknown };
export type DocumentFailureReason =
  | "unauthenticated" | "forbidden" | "not_found" | "team_access_ended" | "invalid_request" | "validation_error"
  | "payload_too_large" | "unsupported_media_type" | "document_content_mismatch" | "document_limit_reached" | "document_version_conflict"
  | "document_already_linked" | "document_link_invalid" | "document_storage_unavailable" | "invalid_idempotency_key" | "idempotency_conflict"
  | "server_error" | "no_response" | "unrecognized_response";
export type DocumentFieldErrors = Partial<Record<"file" | "name" | "expected_version", string>>;
export type DocumentFailure = {
  ok: false;
  reason: DocumentFailureReason;
  message: string;
  reference: { status?: number; code?: string };
  fields?: DocumentFieldErrors;
  /** The list or the scope moved (limit, version): the caller reloads before trying again. */
  reload?: boolean;
  /** The request may have been applied: look at the list before repeating it. */
  uncertain?: boolean;
  currentVersion?: number;
  linkId?: string;
};

const text = z.string();
const plain = <C extends string>(code: C) => z.object({ error: text, code: z.literal(code) }).passthrough();
const withData = <C extends string, D extends z.ZodTypeAny>(code: C, data: D) =>
  z.object({ error: text, code: z.literal(code), data }).strict();
const positive = z.number().int().positive().safe();

const envelopeSchema = z.union([
  plain("unauthenticated"), plain("forbidden"), plain("not_found"), plain("team_access_ended"), plain("invalid_request"),
  plain("invalid_idempotency_key"), plain("idempotency_conflict"), plain("document_storage_unavailable"),
  z.object({
    error: text, code: z.literal("validation_error"),
    fields: z.array(z.object({ field: z.enum(["name", "file", "expected_version"]), code: z.enum(["invalid", "empty", "required"]) }).strict()).optional(),
  }).strict(),
  withData("payload_too_large", z.object({ max_bytes: positive }).strict()),
  withData("unsupported_media_type", z.object({ formats: z.array(formatDescriptorSchema) }).strict()),
  withData("document_content_mismatch", z.object({ detected_format: documentFormatSchema.nullable(), extension: z.string().max(32) }).strict()),
  withData("document_limit_reached", z.object({ kind: z.enum(["documents", "versions"]), limit: positive }).strict()),
  withData("document_version_conflict", z.object({ current_version: positive }).strict()),
  withData("document_already_linked", z.object({ link_id: z.string().uuid() }).strict()),
  withData("document_link_invalid", z.object({ reason: z.enum(["not_replacement", "source_not_in_chain", "version_not_found"]) }).strict()),
]);
export type DocumentEnvelope = z.infer<typeof envelopeSchema>;

/** `undefined` for an unknown code, an unknown `data`/`fields` key or value, or anything that is not the `{error, code, …}` envelope. */
export function decodeDocumentEnvelope(value: unknown): DocumentEnvelope | undefined {
  const parsed = envelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** What a BFF route sends the browser: the code twice (as the CV routes) plus the allowlisted `data`/`fields`; never the backend text. */
export function routeEnvelope(envelope: DocumentEnvelope): { error: string; code: string; data?: unknown; fields?: unknown } {
  const extra: { data?: unknown; fields?: unknown } = {};
  if ("data" in envelope) extra.data = envelope.data;
  if ("fields" in envelope && envelope.fields) extra.fields = envelope.fields;
  return { error: envelope.code, code: envelope.code, ...extra };
}

const formatNames: Record<DocumentFormat, string> = { pdf: "PDF", docx: "DOCX", xlsx: "XLSX", jpg: "JPG", png: "PNG" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function sizeLabel(bytes: number): string {
  if (bytes >= 1_048_576) {
    const mb = bytes / 1_048_576;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function orList(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

const messages = {
  unauthenticated: "Inicia sesión para continuar.",
  forbidden: "No tienes permiso para modificar los documentos de esta vacante.",
  not_found: "No encontramos este documento o ya no tienes acceso.",
  team_access_ended: "Tu acceso al equipo de esta vacante terminó.",
  invalid_request: "No pudimos procesar la solicitud. Revisa los datos y vuelve a intentarlo.",
  validation_error: "Revisa los datos marcados.",
  payload_too_large: "El archivo es demasiado grande.",
  unsupported_media_type: "Ese formato no se admite.",
  document_content_mismatch: "El contenido del archivo no coincide con su extensión.",
  document_limit_reached: "Se alcanzó el límite de documentos o versiones.",
  document_version_conflict: "Otra persona reemplazó este documento. Actualizamos la lista; revisa y vuelve a intentarlo.",
  document_already_linked: "Ese documento ya está vinculado a este espacio.",
  document_link_invalid: "No se pudo vincular ese documento.",
  document_storage_unavailable: "El almacenamiento de documentos no está disponible por ahora. Vuelve a intentarlo en unos minutos.",
  invalid_idempotency_key: "No pudimos enviar el archivo. Vuelve a intentarlo.",
  idempotency_conflict: "Esta subida ya se envió con otro archivo. Cierra el diálogo y vuelve a intentarlo.",
  server_error: "No pudimos completar la operación. Actualiza la lista para ver si se aplicó antes de volver a intentarlo.",
  no_response: "No pudimos confirmar la operación. Actualiza la lista para ver si se aplicó antes de volver a intentarlo.",
  unrecognized_response: "No pudimos interpretar la respuesta. Actualiza la lista para ver si la operación se aplicó.",
} as const satisfies Record<DocumentFailureReason, string>;
const fieldMessages = {
  file_empty: "El archivo está vacío. Elige otro.",
  name_invalid: "El nombre no es válido. Escribe otro nombre.",
  expected_version: "No pudimos comprobar la versión del documento. Actualiza la lista y vuelve a intentarlo.",
} as const;
const linkReasons = {
  not_replacement: "Solo un proceso de reemplazo, o un candidato retomado, puede vincular documentos del proceso original.",
  source_not_in_chain: "Ese documento no pertenece al proceso original de este reemplazo.",
  version_not_found: "La versión elegida de ese documento ya no existe. Actualiza la lista.",
} as const;

export function mapDocumentFailure({ error, envelope }: DocumentFailureInput): DocumentFailure {
  const status = error.status;
  const decoded = decodeDocumentEnvelope(envelope);
  const raw = z.object({ code: z.string() }).passthrough().safeParse(envelope);
  /** The envelope's code, only when this status is the one the contract gives that code (a code on the wrong status is ignored). */
  const known = raw.success && raw.data.code in STATUS && STATUS[raw.data.code as DocumentEnvelope["code"]] === status ? (raw.data.code as DocumentEnvelope["code"]) : undefined;
  /** Its strict `data`/`fields`, when they decode. */
  const strict = <C extends DocumentEnvelope["code"]>(wanted: C) => (known === wanted && decoded?.code === wanted ? (decoded as Extract<DocumentEnvelope, { code: C }>) : undefined);
  const reference = { ...(status !== undefined ? { status } : {}), ...(known ? { code: known } : {}) };
  const done = (reason: DocumentFailureReason, extra: Partial<DocumentFailure> = {}): DocumentFailure => ({ ok: false, reason, message: messages[reason], reference, ...extra });
  const unsure = (reason: "server_error" | "no_response" | "unrecognized_response") => done(reason, { uncertain: true });

  if (error.kind === "missing_token" || status === 401) return done("unauthenticated");
  if (error.kind === "invalid_request") return done("invalid_request");
  if (error.kind === "network" || error.kind === "timeout") return unsure("no_response");
  if (error.kind === "invalid_response") return unsure("unrecognized_response");

  switch (status) {
    case 400: {
      const mismatch = strict("document_content_mismatch");
      if (mismatch) {
        const { detected_format: detected, extension } = mismatch.data;
        return done("document_content_mismatch", {
          message: detected
            ? `El contenido del archivo no coincide con su extensión (${extension || "sin extensión"}): parece un archivo ${formatNames[detected]}. Cambia la extensión o elige otro archivo.`
            : `No reconocimos el contenido del archivo (${extension || "sin extensión"}). Revisa que no esté dañado ni protegido con contraseña.`,
        });
      }
      if (known === "document_content_mismatch") return done("document_content_mismatch");
      const validation = strict("validation_error");
      if (validation) {
        const fields: DocumentFieldErrors = {};
        for (const { field, code } of validation.fields ?? []) {
          if (field === "file" && code === "empty") fields.file = fieldMessages.file_empty;
          else if (field === "name" && code === "invalid") fields.name = fieldMessages.name_invalid;
          else if (field === "expected_version") fields.expected_version = fieldMessages.expected_version;
        }
        if (Object.keys(fields).length > 0) return done("validation_error", { fields, ...(fields.expected_version ? { reload: true } : {}) });
      }
      return known === "invalid_idempotency_key" ? done("invalid_idempotency_key") : done("invalid_request");
    }
    case 403: return done("forbidden");
    case 404: return known === "team_access_ended" ? done("team_access_ended") : done("not_found");
    case 409: {
      const limit = strict("document_limit_reached");
      if (limit) {
        const { kind, limit: max } = limit.data;
        return done("document_limit_reached", {
          reload: true,
          message: kind === "versions"
            ? `Este documento ya tiene ${plural(max, "versión", "versiones")}, que es el máximo. No se pueden agregar más versiones.`
            : `Este espacio ya tiene ${plural(max, "documento", "documentos")}, que es el máximo. Elimina o desvincula alguno para continuar.`,
        });
      }
      if (known === "document_limit_reached") return done("document_limit_reached", { reload: true });
      const conflict = strict("document_version_conflict");
      if (conflict) {
        const current = conflict.data.current_version;
        return done("document_version_conflict", {
          reload: true, currentVersion: current,
          message: `Otra persona reemplazó este documento y ahora está en la versión ${current}. Actualizamos la lista; revisa y vuelve a intentarlo.`,
        });
      }
      if (known === "document_version_conflict") return done("document_version_conflict", { reload: true });
      if (known === "document_already_linked") return done("document_already_linked", { reload: true, ...(strict("document_already_linked") ? { linkId: strict("document_already_linked")!.data.link_id } : {}) });
      return known === "idempotency_conflict" ? done("idempotency_conflict") : unsure("unrecognized_response");
    }
    case 413: {
      const tooLarge = strict("payload_too_large");
      return tooLarge ? done("payload_too_large", { message: `El archivo es demasiado grande. El máximo es de ${sizeLabel(tooLarge.data.max_bytes)}.` }) : done("payload_too_large");
    }
    case 415: {
      const unsupported = strict("unsupported_media_type");
      const extensions = unsupported ? unsupported.data.formats.flatMap(format => format.extensions) : [];
      return done("unsupported_media_type", extensions.length > 0 ? { message: `Ese formato no se admite. Usa un archivo ${orList(extensions)}.` } : {});
    }
    case 422: {
      const invalid = strict("document_link_invalid");
      return invalid
        ? done("document_link_invalid", { message: linkReasons[invalid.data.reason], ...(invalid.data.reason !== "not_replacement" ? { reload: true } : {}) })
        : done("document_link_invalid");
    }
    case 503: return known === "document_storage_unavailable" ? done("document_storage_unavailable") : unsure("server_error");
    default:
      return status !== undefined && status >= 500 && status < 600 ? unsure("server_error") : unsure("unrecognized_response");
  }
}

const STATUS: Record<DocumentEnvelope["code"], number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, team_access_ended: 404, invalid_request: 400, invalid_idempotency_key: 400,
  idempotency_conflict: 409, document_storage_unavailable: 503, validation_error: 400, payload_too_large: 413, unsupported_media_type: 415,
  document_content_mismatch: 400, document_limit_reached: 409, document_version_conflict: 409, document_already_linked: 409, document_link_invalid: 422,
};
