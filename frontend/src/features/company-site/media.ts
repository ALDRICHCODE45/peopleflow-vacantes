import { z } from "zod";
import { mediaSchema } from "./api/model";
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const mediaKindSchema = z.enum(["cover", "gallery", "portrait", "story"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;
/** Sections v2 upload kinds: `logo` (logos block) needs backend slice A (migration 00066); the
 * upload route keeps `mediaKindSchema` until SECTIONS_V2_ENABLED is switched on. */
export const mediaKindSchemaV2 = z.enum([...mediaKindSchema.options, "logo"]);
export type MediaKindV2 = z.infer<typeof mediaKindSchemaV2>;
/** Logos keep their transparency, so only alpha-capable formats; smaller minimum side than photos. */
export const LOGO_MEDIA_TYPES = ["image/png", "image/webp"] as const;
export const LOGO_MIN_PX = 64;

// ---------------------------------------------------------------------------
// Slice B: «Fondo en movimiento» background video (backend-confirmed 2026-11-26;
// names and limits live only here). Same multipart endpoint with kind=hero_video.
// ---------------------------------------------------------------------------
export const HERO_VIDEO_KIND = "hero_video" as const;
export const HERO_VIDEO_TYPE = "video/mp4" as const;
/** 20 MB = 20971520 bytes. */
export const HERO_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const HERO_VIDEO_MAX_MS = 30_000;
/** How long the browser may take to read the file's duration before we give up. */
export const HERO_VIDEO_METADATA_TIMEOUT_MS = 10_000;
/** Same-origin upload route; the video path streams a raw `video/mp4` body. */
export const HERO_VIDEO_UPLOAD_PATH = `/api/company/site/media?kind=${HERO_VIDEO_KIND}`;
export const HERO_VIDEO_MESSAGES = Object.freeze({
  type: "Sube un video MP4.",
  size: "El video pesa más de 20 MB.",
  duration: "El video dura más de 30 segundos.",
  unreadable: "No pudimos leer el video.",
});
/** Backend codes for hero_video failures (415 / 413 reuse the image codes; 422 `video_too_long`
 * also carries {max_ms, duration_ms}, `video_invalid` = no moov/mvhd, zero duration, malformed). */
export const HERO_VIDEO_ERROR_CODES = Object.freeze({ type: "unsupported_media_type", size: "payload_too_large", duration: "video_too_long", unreadable: "video_invalid" });
/** Every upload kind the route accepts with sections v2 (images plus the background video). */
export const uploadKindSchemaV2 = z.enum([...mediaKindSchemaV2.options, HERO_VIDEO_KIND]);
export type UploadKindV2 = z.infer<typeof uploadKindSchemaV2>;
/** Spanish copy for a hero_video upload failure: 415/413/422 map to the pre-check messages. */
export function heroVideoMessage(status: number, value: unknown): string {
  const code = z.object({ code: z.string() }).safeParse(value).data?.code;
  if (status === 415) return HERO_VIDEO_MESSAGES.type;
  if (status === 413) return HERO_VIDEO_MESSAGES.size;
  if (status === 422 && code === HERO_VIDEO_ERROR_CODES.unreadable) return HERO_VIDEO_MESSAGES.unreadable;
  if (status === 422 && code !== "media_limit_reached") return HERO_VIDEO_MESSAGES.duration;
  return mediaMessage(status, value);
}

export const uploadedMediaSchema = mediaSchema.extend({ content_type: z.enum([...MEDIA_TYPES, HERO_VIDEO_TYPE]) });
export type UploadedMedia = z.infer<typeof uploadedMediaSchema>;
export const mediaErrorStatuses: Record<string, number> = {
  invalid_request: 400, unauthenticated: 401, forbidden: 403, company_inactive: 403,
  payload_too_large: 413, unsupported_media_type: 415, image_too_small: 422,
  image_too_large: 422, media_limit_reached: 422,
  [HERO_VIDEO_ERROR_CODES.duration]: 422, [HERO_VIDEO_ERROR_CODES.unreadable]: 422,
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
  [HERO_VIDEO_ERROR_CODES.duration]: HERO_VIDEO_MESSAGES.duration,
  [HERO_VIDEO_ERROR_CODES.unreadable]: HERO_VIDEO_MESSAGES.unreadable,
};
export function mediaMessage(status: number, value: unknown): string {
  const parsed = z.object({ code: z.string() }).safeParse(value);
  if (!parsed.success) return MEDIA_UNCERTAIN;
  const code = parsed.data.code;
  if (code === "unavailable" && status === 503) return messages.unavailable;
  return mediaErrorStatuses[code] === status ? messages[code] : MEDIA_UNCERTAIN;
}
