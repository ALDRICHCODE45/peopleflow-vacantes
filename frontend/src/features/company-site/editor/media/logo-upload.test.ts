// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { uploadMedia } from "../../upload";
afterEach(() => vi.unstubAllGlobals());
const file = (type: string) => new File(["image"], "logo", { type });

it("refuses a JPEG logo before any request: logos keep their transparency", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect(await uploadMedia("logo", file("image/jpeg"))).toEqual({ ok: false, message: "Usa un logo PNG o WebP. Así conserva su fondo transparente." });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  [415, "unsupported_media_type", "Usa un logo PNG o WebP. Así conserva su fondo transparente."],
  [422, "image_too_small", "El logo es demasiado pequeño. Usa al menos 64 px por lado."],
  [422, "media_limit_reached", "Alcanzaste el límite de 300 imágenes."],
])("explains the backend logo answer %s %s in Spanish", async (status, code, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code }, { status })));
  expect(await uploadMedia("logo", file("image/png"))).toEqual({ ok: false, message });
});
it("keeps the photo copy for every other kind", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "image_too_small" }, { status: 422 })));
  expect(await uploadMedia("portrait", file("image/png"))).toEqual({ ok: false, message: "La imagen es demasiado pequeña. Usa al menos 200 px por lado." });
});
it("posts kind logo and accepts the logo it gets back", async () => {
  const data = { id: "12345678-1234-4123-8123-123456789abc", kind: "logo", url: "/v2/company-sites/media/12345678-1234-4123-8123-123456789abc", width: 128, height: 64, content_type: "image/webp" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data, { status: 201 })));
  expect(await uploadMedia("logo", file("image/webp"))).toEqual({ ok: true, data });
  expect(((vi.mocked(fetch).mock.calls[0][1]!.body) as FormData).get("kind")).toBe("logo");
});
