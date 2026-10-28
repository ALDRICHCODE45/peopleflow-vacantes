// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { uploadMedia } from "@/features/company-site/upload";
afterEach(() => vi.unstubAllGlobals());
const file = () => new File(["image"], "photo.png", { type: "image/png" });
it.each([
  [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), "El archivo pesa más de 5 MB."],
  [new File(["x"], "bad.gif", { type: "image/gif" }), "Usa una imagen JPEG, PNG o WebP."],
])("prevalidates unsupported or oversized files without a request", async (image, message) => {
  vi.stubGlobal("fetch", vi.fn()); expect(await uploadMedia("cover", image)).toEqual({ ok: false, message }); expect(fetch).not.toHaveBeenCalled();
});
it.each([
  [400, "invalid_request", "No pudimos subir la imagen. Revisa el archivo."],
  [401, "unauthenticated", "Inicia sesión para subir imágenes."],
  [403, "forbidden", "No tienes permiso para subir imágenes."],
  [403, "company_inactive", "No tienes permiso para subir imágenes."],
  [413, "payload_too_large", "El archivo pesa más de 5 MB."],
  [415, "unsupported_media_type", "Usa una imagen JPEG, PNG o WebP."],
  [422, "image_too_small", "La imagen es demasiado pequeña. Usa al menos 200 px por lado."],
  [422, "image_too_large", "La imagen es demasiado grande. Usa hasta 6000 px por lado."],
  [422, "media_limit_reached", "Alcanzaste el límite de 300 imágenes."],
  [503, "unavailable", "La subida de imágenes no está disponible ahora."],
  [503, "no_response", "No pudimos confirmar la subida. Revisa tu conexión e inténtalo de nuevo."],
])("maps %s %s to Spanish", async (status, code, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code }, { status })));
  expect(await uploadMedia("cover", file())).toEqual({ ok: false, message });
});
it("network failure is uncertain and never retried", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await uploadMedia("cover", file())).toEqual({ ok: false, message: "No pudimos confirmar la subida. Revisa tu conexión e inténtalo de nuevo." }); expect(fetch).toHaveBeenCalledOnce();
});
it("posts exactly kind and file to the fixed same-origin route", async () => {
  const data = { id: "12345678-1234-4123-8123-123456789abc", kind: "cover", url: "/v2/company-sites/media/12345678-1234-4123-8123-123456789abc", width: 800, height: 600, content_type: "image/png" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data, { status: 201 })));
  expect(await uploadMedia("cover", file())).toEqual({ ok: true, data });
  expect(fetch).toHaveBeenCalledWith("/api/company/site/media", expect.objectContaining({ credentials: "same-origin", redirect: "error", method: "POST" }));
  expect([...((vi.mocked(fetch).mock.calls[0][1]!.body) as FormData).keys()]).toEqual(["kind", "file"]);
});
it("rejects malformed success without displaying raw data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ url: "secret" }, { status: 201 })));
  expect(await uploadMedia("cover", file())).toMatchObject({ ok: false });
});
