"use client";
import { LOGO_MEDIA_TYPES, LOGO_MIN_PX, MEDIA_MAX_BYTES, MEDIA_TYPES, MEDIA_UNCERTAIN, mediaMessage, uploadedMediaSchema, type MediaKindV2, type UploadedMedia } from "./media";
export type MediaUploadResult = { ok: true; data: UploadedMedia } | { ok: false; message: string };
/** Logos keep their transparency: only alpha-capable formats (the route enforces the same). */
export const mediaTypesFor = (kind: MediaKindV2): readonly string[] => kind === "logo" ? LOGO_MEDIA_TYPES : MEDIA_TYPES;
const LOGO_MESSAGES: Record<string, string> = {
  unsupported_media_type: "Usa un logo PNG o WebP. Así conserva su fondo transparente.",
  image_too_small: `El logo es demasiado pequeño. Usa al menos ${LOGO_MIN_PX} px por lado.`,
};
/** Logos answer with their own limits (PNG/WebP, 64 px); every other code keeps the shared copy. */
function messageFor(kind: MediaKindV2, status: number, value: unknown): string {
  const message = mediaMessage(status, value);
  if (kind !== "logo" || message === MEDIA_UNCERTAIN) return message;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && LOGO_MESSAGES[code] ? LOGO_MESSAGES[code] : message;
}
/** Mirrors CV uploads: fixed same-origin fetch, no automatic replay or invented progress events. */
export async function uploadMedia(kind: MediaKindV2, file: File): Promise<MediaUploadResult> {
  if (file.size > MEDIA_MAX_BYTES) return { ok: false, message: mediaMessage(413, { code: "payload_too_large" }) };
  if (!mediaTypesFor(kind).includes(file.type)) return { ok: false, message: messageFor(kind, 415, { code: "unsupported_media_type" }) };
  const body = new FormData(); body.append("kind", kind); body.append("file", file);
  try {
    const response = await fetch("/api/company/site/media", { method: "POST", body, cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60_000) });
    const value: unknown = await response.json();
    if (response.status !== 201) return { ok: false, message: messageFor(kind, response.status, value) };
    const parsed = uploadedMediaSchema.safeParse(value);
    return parsed.success && parsed.data.kind === kind ? { ok: true, data: parsed.data } : { ok: false, message: MEDIA_UNCERTAIN };
  } catch { return { ok: false, message: MEDIA_UNCERTAIN }; }
}
