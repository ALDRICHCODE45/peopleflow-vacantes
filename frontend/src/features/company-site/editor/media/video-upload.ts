"use client";
import {
  HERO_VIDEO_KIND, HERO_VIDEO_MAX_BYTES, HERO_VIDEO_MAX_MS, HERO_VIDEO_MESSAGES, HERO_VIDEO_METADATA_TIMEOUT_MS,
  HERO_VIDEO_TYPE, HERO_VIDEO_UPLOAD_PATH, MEDIA_UNCERTAIN, heroVideoMessage, uploadedMediaSchema, type UploadedMedia,
} from "../../media";

/** MP4 by MIME type, or an untyped file named `.mp4` (some systems don't type videos). */
export function isMp4(file: File): boolean {
  return file.type === HERO_VIDEO_TYPE || (file.type === "" && /\.mp4$/i.test(file.name));
}

/** Reads the duration (seconds) from a detached, muted <video> that only loads metadata. */
export function readVideoDuration(file: File, timeoutMs = HERO_VIDEO_METADATA_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (result: () => void) => {
      clearTimeout(timer);
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute("src"); video.load();
      URL.revokeObjectURL(url);
      result();
    };
    const timer = setTimeout(() => done(() => reject(new Error("timeout"))), timeoutMs);
    video.onloadedmetadata = () => { const seconds = video.duration; done(() => resolve(seconds)); };
    video.onerror = () => done(() => reject(new Error("unreadable")));
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
  });
}

/** The first limit the file breaks (Spanish copy), or null when it can be uploaded. */
export async function checkHeroVideo(file: File, { timeoutMs }: { timeoutMs?: number } = {}): Promise<string | null> {
  if (!isMp4(file)) return HERO_VIDEO_MESSAGES.type;
  if (file.size > HERO_VIDEO_MAX_BYTES) return HERO_VIDEO_MESSAGES.size;
  let seconds: number;
  try { seconds = await readVideoDuration(file, timeoutMs); } catch { return HERO_VIDEO_MESSAGES.unreadable; }
  if (!Number.isFinite(seconds) || seconds <= 0) return HERO_VIDEO_MESSAGES.unreadable;
  return seconds * 1000 > HERO_VIDEO_MAX_MS ? HERO_VIDEO_MESSAGES.duration : null;
}

/** `message: null` = the person cancelled; nothing to show. */
export type HeroVideoUploadResult = { ok: true; data: UploadedMedia } | { ok: false; message: string | null };
/** Raw MP4 body (the route streams it to the backend); XHR because fetch has no upload progress. */
export function uploadHeroVideo(file: File, { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<HeroVideoUploadResult> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    const settle = (result: HeroVideoUploadResult) => { signal?.removeEventListener("abort", cancel); resolve(result); };
    const cancel = () => xhr.abort();
    xhr.open("POST", HERO_VIDEO_UPLOAD_PATH);
    xhr.setRequestHeader("content-type", HERO_VIDEO_TYPE);
    xhr.timeout = 180_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      let value: unknown;
      try { value = JSON.parse(xhr.responseText); } catch { settle({ ok: false, message: MEDIA_UNCERTAIN }); return; }
      if (xhr.status !== 201) { settle({ ok: false, message: heroVideoMessage(xhr.status, value) }); return; }
      const parsed = uploadedMediaSchema.safeParse(value);
      settle(parsed.success && parsed.data.kind === HERO_VIDEO_KIND ? { ok: true, data: parsed.data } : { ok: false, message: MEDIA_UNCERTAIN });
    };
    xhr.onerror = xhr.ontimeout = () => settle({ ok: false, message: MEDIA_UNCERTAIN });
    xhr.onabort = () => settle({ ok: false, message: null });
    if (signal?.aborted) { settle({ ok: false, message: null }); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    xhr.send(file);
  });
}
