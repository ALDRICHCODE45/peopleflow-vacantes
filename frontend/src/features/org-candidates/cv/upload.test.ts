import { afterEach, expect, it, vi } from "vitest";
import { submitOrgCandidateCv } from "./upload";
import { cvFailureMessage } from "./cv-model";
const id = "00000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
it.each([
 [401, "unauthenticated", "Tu sesión expiró. Inicia sesión de nuevo."],
 [412, "precondition_failed", "Esto cambió en otro lugar. Conservamos tu archivo; revisa y vuelve a subirlo."],
 [413, "cv_too_large", "El archivo pesa más de 5 MB."],
 [500, "server_error", "No pudimos confirmar el guardado. Actualiza la ficha antes de volver a subirlo."],
])("preserves status %s and UI classification for HTML and empty errors", async (status, reason, message) => {
 for (const body of ["<html>upstream error</html>", ""]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
  const result = await submitOrgCandidateCv({ kind: "manual", id }, id, '"v1"', new File(["pdf"], "cv.pdf", { type: "application/pdf" }));
  expect(result).toEqual({ ok: false, reason, reference: { status } });
  if (result.ok) throw new Error("expected failure");
  expect(cvFailureMessage(result)).toBe(message);
 }
});
it.each(["", "<html>unexpected success</html>"])("keeps malformed success handling for %s", async body => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
 expect(await submitOrgCandidateCv({ kind: "manual", id }, id, '"v1"', new File(["pdf"], "cv.pdf", { type: "application/pdf" })))
  .toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 502, code: "unrecognized_response" } });
});
