import { describe, expect, it } from "vitest";
import { decodeDocumentEnvelope, mapDocumentFailure, routeEnvelope } from "./failure";
import { formatsWire, ids } from "./test-fixtures";

const status = (httpStatus: number, envelope?: unknown) => mapDocumentFailure({ error: { kind: "status", status: httpStatus }, ...(envelope === undefined ? {} : { envelope }) });
const env = (code: string, extra: Record<string, unknown> = {}) => ({ error: "texto privado del servidor", code, ...extra });

describe("mapDocumentFailure: the document_* family", () => {
  it("payload_too_large takes the limit from data.max_bytes, never from a constant", () => {
    expect(status(413, env("payload_too_large", { data: { max_bytes: 10485760 } }))).toMatchObject({
      ok: false, reason: "payload_too_large", message: "El archivo es demasiado grande. El máximo es de 10 MB.", reference: { status: 413, code: "payload_too_large" },
    });
    expect(status(413, env("payload_too_large", { data: { max_bytes: 5242880 } })).message).toBe("El archivo es demasiado grande. El máximo es de 5 MB.");
    expect(status(413, env("payload_too_large", { data: { max_bytes: 2621440 } })).message).toBe("El archivo es demasiado grande. El máximo es de 2,5 MB.");
    expect(status(413, env("payload_too_large", { data: { max_bytes: 512000 } })).message).toBe("El archivo es demasiado grande. El máximo es de 500 KB.");
  });
  it("payload_too_large without usable data keeps a message with no number", () => {
    expect(status(413).message).toBe("El archivo es demasiado grande.");
    expect(status(413, env("payload_too_large", { data: { max_bytes: "10MB" } }))).toMatchObject({ reason: "payload_too_large", message: "El archivo es demasiado grande." });
  });
  it("unsupported_media_type lists the extensions of data.formats", () => {
    expect(status(415, env("unsupported_media_type", { data: { formats: formatsWire() } }))).toMatchObject({
      ok: false, reason: "unsupported_media_type",
      message: "Ese formato no se admite. Usa un archivo .pdf, .docx, .xlsx, .jpg, .jpeg o .png.", reference: { status: 415, code: "unsupported_media_type" },
    });
    expect(status(415, env("unsupported_media_type", { data: { formats: [formatsWire()[0]] } })).message).toBe("Ese formato no se admite. Usa un archivo .pdf.");
    expect(status(415, env("unsupported_media_type", { data: { formats: formatsWire().slice(0, 2) } })).message).toBe("Ese formato no se admite. Usa un archivo .pdf o .docx.");
  });
  it("unsupported_media_type without data stays generic", () => {
    expect(status(415, env("unsupported_media_type"))).toMatchObject({ reason: "unsupported_media_type", message: "Ese formato no se admite." });
  });
  it("validation_error: an empty file, an invalid name and expected_version each get their own field message", () => {
    expect(status(400, env("validation_error", { fields: [{ field: "file", code: "empty" }] }))).toMatchObject({
      reason: "validation_error", message: "Revisa los datos marcados.", fields: { file: "El archivo está vacío. Elige otro." },
    });
    expect(status(400, env("validation_error", { fields: [{ field: "name", code: "invalid" }] }))).toMatchObject({
      fields: { name: "El nombre no es válido. Escribe otro nombre." },
    });
    expect(status(400, env("validation_error", { fields: [{ field: "expected_version", code: "required" }] }))).toMatchObject({
      reload: true, fields: { expected_version: "No pudimos comprobar la versión del documento. Actualiza la lista y vuelve a intentarlo." },
    });
    expect(status(400, env("validation_error", { fields: [{ field: "expected_version", code: "invalid" }] }))).toMatchObject({ reload: true });
  });
  it("validation_error with an unknown field falls back to a generic invalid_request", () => {
    expect(status(400, env("validation_error", { fields: [{ field: "color", code: "invalid" }] }))).toMatchObject({
      reason: "invalid_request", message: "No pudimos procesar la solicitud. Revisa los datos y vuelve a intentarlo.",
    });
  });
  it("document_content_mismatch names the detected format and the extension", () => {
    expect(status(400, env("document_content_mismatch", { data: { detected_format: "docx", extension: ".pdf" } }))).toMatchObject({
      reason: "document_content_mismatch", reference: { status: 400, code: "document_content_mismatch" },
      message: "El contenido del archivo no coincide con su extensión (.pdf): parece un archivo DOCX. Cambia la extensión o elige otro archivo.",
    });
    expect(status(400, env("document_content_mismatch", { data: { detected_format: "jpg", extension: "" } })).message)
      .toBe("El contenido del archivo no coincide con su extensión (sin extensión): parece un archivo JPG. Cambia la extensión o elige otro archivo.");
  });
  it("document_content_mismatch with no detected format says the content was not recognized", () => {
    expect(status(400, env("document_content_mismatch", { data: { detected_format: null, extension: ".xlsx" } })).message)
      .toBe("No reconocimos el contenido del archivo (.xlsx). Revisa que no esté dañado ni protegido con contraseña.");
  });
  it("document_limit_reached takes kind and limit from data and asks the caller to reload", () => {
    expect(status(409, env("document_limit_reached", { data: { kind: "documents", limit: 50 } }))).toMatchObject({
      reason: "document_limit_reached", reload: true,
      message: "Este espacio ya tiene 50 documentos, que es el máximo. Elimina o desvincula alguno para continuar.",
    });
    expect(status(409, env("document_limit_reached", { data: { kind: "documents", limit: 20 } })).message)
      .toBe("Este espacio ya tiene 20 documentos, que es el máximo. Elimina o desvincula alguno para continuar.");
    expect(status(409, env("document_limit_reached", { data: { kind: "versions", limit: 25 } })).message)
      .toBe("Este documento ya tiene 25 versiones, que es el máximo. No se pueden agregar más versiones.");
    expect(status(409, env("document_limit_reached", { data: { kind: "documents", limit: 1 } })).message)
      .toBe("Este espacio ya tiene 1 documento, que es el máximo. Elimina o desvincula alguno para continuar.");
  });
  it("document_limit_reached without data or with an unknown kind says no number", () => {
    expect(status(409, env("document_limit_reached"))).toMatchObject({ reason: "document_limit_reached", message: "Se alcanzó el límite de documentos o versiones." });
    expect(status(409, env("document_limit_reached", { data: { kind: "links", limit: 5 } })).message).toBe("Se alcanzó el límite de documentos o versiones.");
  });
  it("document_version_conflict names the current version and asks to reload", () => {
    expect(status(409, env("document_version_conflict", { data: { current_version: 3 } }))).toMatchObject({
      reason: "document_version_conflict", reload: true, currentVersion: 3,
      message: "Otra persona reemplazó este documento y ahora está en la versión 3. Actualizamos la lista; revisa y vuelve a intentarlo.",
    });
    expect(status(409, env("document_version_conflict"))).toMatchObject({
      reload: true, message: "Otra persona reemplazó este documento. Actualizamos la lista; revisa y vuelve a intentarlo.",
    });
  });
  it("document_already_linked carries the existing link id", () => {
    expect(status(409, env("document_already_linked", { data: { link_id: ids.link } }))).toMatchObject({
      reason: "document_already_linked", linkId: ids.link, reload: true, message: "Ese documento ya está vinculado a este espacio.",
    });
    expect(status(409, env("document_already_linked"))).toMatchObject({ reason: "document_already_linked", message: "Ese documento ya está vinculado a este espacio." });
    expect(status(409, env("document_already_linked", { data: { link_id: "nope" } })).linkId).toBeUndefined();
  });
  it.each([
    ["not_replacement", "Solo un proceso de reemplazo, o un candidato retomado, puede vincular documentos del proceso original."],
    ["source_not_in_chain", "Ese documento no pertenece al proceso original de este reemplazo."],
    ["version_not_found", "La versión elegida de ese documento ya no existe. Actualiza la lista."],
  ] as const)("document_link_invalid %s", (reason, message) => {
    expect(status(422, env("document_link_invalid", { data: { reason } }))).toMatchObject({ reason: "document_link_invalid", message, ...(reason === "not_replacement" ? {} : { reload: true }) });
  });
  it("document_link_invalid with an unknown reason is a generic invalid link", () => {
    expect(status(422, env("document_link_invalid", { data: { reason: "other" } })).message).toBe("No se pudo vincular ese documento.");
  });
  it("document_storage_unavailable is a 503 that records nothing", () => {
    expect(status(503, env("document_storage_unavailable"))).toMatchObject({
      reason: "document_storage_unavailable", reference: { status: 503, code: "document_storage_unavailable" },
      message: "El almacenamiento de documentos no está disponible por ahora. Vuelve a intentarlo en unos minutos.",
    });
  });
  it("idempotency codes", () => {
    expect(status(400, env("invalid_idempotency_key"))).toMatchObject({ reason: "invalid_idempotency_key", message: "No pudimos enviar el archivo. Vuelve a intentarlo." });
    expect(status(409, env("idempotency_conflict"))).toMatchObject({
      reason: "idempotency_conflict", message: "Esta subida ya se envió con otro archivo. Cierra el diálogo y vuelve a intentarlo.",
    });
  });
});

describe("mapDocumentFailure: the generic family", () => {
  it.each([
    [401, "unauthenticated", "Inicia sesión para continuar."],
    [403, "forbidden", "No tienes permiso para modificar los documentos de esta vacante."],
    [404, "not_found", "No encontramos este documento o ya no tienes acceso."],
    [400, "invalid_request", "No pudimos procesar la solicitud. Revisa los datos y vuelve a intentarlo."],
  ] as const)("%s %s", (code, reason, message) => {
    expect(status(code, env(reason))).toMatchObject({ ok: false, reason, message, reference: { status: code, code: reason } });
  });
  it("team_access_ended is a 404 with its own message", () => {
    expect(status(404, env("team_access_ended"))).toMatchObject({ reason: "team_access_ended", message: "Tu acceso al equipo de esta vacante terminó." });
  });
  it("classifies without an envelope", () => {
    expect(status(401)).toMatchObject({ reason: "unauthenticated" });
    expect(status(403)).toMatchObject({ reason: "forbidden" });
    expect(status(404)).toMatchObject({ reason: "not_found" });
    expect(status(500)).toMatchObject({ reason: "server_error", uncertain: true });
    expect(status(502)).toMatchObject({ reason: "server_error" });
    expect(status(418)).toMatchObject({ reason: "unrecognized_response", uncertain: true });
  });
  it("transport kinds", () => {
    expect(mapDocumentFailure({ error: { kind: "missing_token" } })).toMatchObject({ reason: "unauthenticated" });
    expect(mapDocumentFailure({ error: { kind: "invalid_request" } })).toMatchObject({ reason: "invalid_request" });
    expect(mapDocumentFailure({ error: { kind: "network" } })).toMatchObject({
      reason: "no_response", uncertain: true, message: "No pudimos confirmar la operación. Actualiza la lista para ver si se aplicó antes de volver a intentarlo.",
    });
    expect(mapDocumentFailure({ error: { kind: "timeout" } })).toMatchObject({ reason: "no_response" });
    expect(mapDocumentFailure({ error: { kind: "invalid_response" } })).toMatchObject({ reason: "unrecognized_response", uncertain: true });
  });
  it("a code on the wrong status does not decode: it is judged by status alone", () => {
    expect(status(500, env("payload_too_large", { data: { max_bytes: 1 } }))).toMatchObject({ reason: "server_error" });
    expect(status(404, env("document_limit_reached", { data: { kind: "documents", limit: 50 } }))).toMatchObject({ reason: "not_found" });
    expect(status(503, env("not_found"))).toMatchObject({ reason: "server_error" });
  });
  it("never forwards the backend text or unknown codes", () => {
    const failure = status(409, env("something_new", { error: "private-token" }));
    expect(JSON.stringify(failure)).not.toContain("private-token");
    expect(failure.reference).toEqual({ status: 409 });
  });
});

describe("decodeDocumentEnvelope and routeEnvelope", () => {
  it("decodes only known codes with their strict data", () => {
    expect(decodeDocumentEnvelope(env("payload_too_large", { data: { max_bytes: 10485760 } }))).toEqual({
      error: "texto privado del servidor", code: "payload_too_large", data: { max_bytes: 10485760 },
    });
    expect(decodeDocumentEnvelope(env("payload_too_large", { data: { max_bytes: 10485760, extra: 1 } }))).toBeUndefined();
    expect(decodeDocumentEnvelope(env("mystery"))).toBeUndefined();
    expect(decodeDocumentEnvelope("nope")).toBeUndefined();
  });
  it("re-emits {error: code, code, data?, fields?} without the backend text", () => {
    expect(routeEnvelope(decodeDocumentEnvelope(env("payload_too_large", { data: { max_bytes: 10485760 } }))!)).toEqual({
      error: "payload_too_large", code: "payload_too_large", data: { max_bytes: 10485760 },
    });
    expect(routeEnvelope(decodeDocumentEnvelope(env("validation_error", { fields: [{ field: "file", code: "empty" }] }))!)).toEqual({
      error: "validation_error", code: "validation_error", fields: [{ field: "file", code: "empty" }],
    });
    expect(routeEnvelope(decodeDocumentEnvelope(env("not_found"))!)).toEqual({ error: "not_found", code: "not_found" });
  });
  it("a route envelope decodes back to the same Spanish message (BFF round trip)", () => {
    const wire = { error: "payload_too_large", code: "payload_too_large", data: { max_bytes: 10485760 } };
    expect(status(413, wire).message).toBe("El archivo es demasiado grande. El máximo es de 10 MB.");
  });
});
