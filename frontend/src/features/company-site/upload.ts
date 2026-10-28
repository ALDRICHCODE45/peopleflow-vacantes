"use client";
import { MEDIA_MAX_BYTES, MEDIA_TYPES, MEDIA_UNCERTAIN, mediaMessage, uploadedMediaSchema, type MediaKind, type UploadedMedia } from "./media";
export type MediaUploadResult = { ok: true; data: UploadedMedia } | { ok: false; message: string };
/** Mirrors CV uploads: fixed same-origin fetch, no automatic replay or invented progress events. */
export async function uploadMedia(kind: MediaKind, file: File): Promise<MediaUploadResult> {
  if (file.size > MEDIA_MAX_BYTES) return { ok: false, message: mediaMessage(413, { code: "payload_too_large" }) };
  if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) return { ok: false, message: mediaMessage(415, { code: "unsupported_media_type" }) };
  const body = new FormData(); body.append("kind", kind); body.append("file", file);
  try {
    const response = await fetch("/api/company/site/media", { method: "POST", body, cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60_000) });
    const value: unknown = await response.json();
    if (response.status !== 201) return { ok: false, message: mediaMessage(response.status, value) };
    const parsed = uploadedMediaSchema.safeParse(value);
    return parsed.success && parsed.data.kind === kind ? { ok: true, data: parsed.data } : { ok: false, message: MEDIA_UNCERTAIN };
  } catch { return { ok: false, message: MEDIA_UNCERTAIN }; }
}
