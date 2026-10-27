import { z } from "zod";
import { mediaSchema } from "./api/model";
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const mediaKindSchema = z.enum(["cover", "gallery", "portrait", "story"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;
export const uploadedMediaSchema = mediaSchema.extend({ content_type: z.enum(MEDIA_TYPES) });
export type UploadedMedia = z.infer<typeof uploadedMediaSchema>;
export const mediaErrorStatuses: Record<string, number> = {
  invalid_request: 400, unauthenticated: 401, forbidden: 403, company_inactive: 403,
  payload_too_large: 413, unsupported_media_type: 415, image_too_small: 422,
  image_too_large: 422, media_limit_reached: 422,
};
export const MEDIA_UNCERTAIN = "No pudimos confirmar la subida. Revisa tu conexión e inténtalo de nuevo.";
const messages: Record<string, string> = {
  invalid_request: "No pudimos subir la imagen. Revisa el archivo.",
  unauthenticated: "Inicia sesión para subir imágenes.",
  forbidden: "No tienes permiso para subir imágenes.",
  company_inactive: "No tienes permiso para subir imágenes.",
  payload_too_large: "El archivo pesa más de 5 MB.",
  unsupported_media_type: "Usa una imagen JPEG, PNG o WebP.",
  image_too_small: "La imagen es demasiado pequeña. Usa al menos 200 px por lado.",
  image_too_large: "La imagen es demasiado grande. Usa hasta 6000 px por lado.",
  media_limit_reached: "Alcanzaste el límite de 300 imágenes.",
  unavailable: "La subida de imágenes no está disponible ahora.",
};
export function mediaMessage(status: number, value: unknown): string {
  const parsed = z.object({ code: z.string() }).safeParse(value);
  if (!parsed.success) return MEDIA_UNCERTAIN;
  const code = parsed.data.code;
  if (code === "unavailable" && status === 503) return messages.unavailable;
  return mediaErrorStatuses[code] === status ? messages[code] : MEDIA_UNCERTAIN;
}
