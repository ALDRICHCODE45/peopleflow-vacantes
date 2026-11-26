import "server-only";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { HERO_VIDEO_ERROR_CODES, HERO_VIDEO_KIND, mediaErrorStatuses, uploadedMediaSchema, type UploadKindV2, type UploadedMedia } from "../media";
export type MediaBackendResult = { ok: true; data: UploadedMedia } | { ok: false; status: number; code: string };
type Body = { body: FormData } | { body: ReadableStream<Uint8Array>; contentType: string };
/** hero_video limits are new on the backend: a 413/415/422 with a code we don't know yet still
 * means size/type/duration, so it keeps its status with the code the browser copy expects. */
const VIDEO_FALLBACK_CODES: Record<number, string> = { 413: HERO_VIDEO_ERROR_CODES.size, 415: HERO_VIDEO_ERROR_CODES.type, 422: HERO_VIDEO_ERROR_CODES.duration };
/** Only a fresh server-session authorization header crosses this boundary. */
async function postMedia(token: string, payload: Body, kind: UploadKindV2): Promise<MediaBackendResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    // A streamed video takes longer than the JSON API timeout to cross the wire.
    timer = setTimeout(() => controller.abort(), kind === HERO_VIDEO_KIND ? Math.max(serverEnv.apiTimeoutMs, 120_000) : serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const endpoint = new URL("/v2/me/company/site/media", base);
    // Only the configured server API origin and this literal endpoint are allowed.
    if (!["http:", "https:"].includes(base.protocol) || endpoint.origin !== base.origin || endpoint.pathname !== "/v2/me/company/site/media" || endpoint.username || endpoint.password) throw new Error("Invalid API endpoint");
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if ("contentType" in payload) headers.set("content-type", payload.contentType);
    // Construct a fresh request after allowlisting; never inherit the browser Request.
    const response = await fetch(new Request(endpoint, {
      method: "POST", body: payload.body, headers, cache: "no-store", redirect: "error", signal: controller.signal,
      ...("contentType" in payload ? { duplex: "half" } : {}),
    } as RequestInit));
    if (response.status === 503) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, status: 503, code: "unavailable" };
    }
    let value: unknown;
    try { value = await boundedJson(response, 4096, controller.signal); }
    catch { return { ok: false, status: controller.signal.aborted ? 503 : 502, code: controller.signal.aborted ? "no_response" : "unrecognized_response" }; }
    if (response.status === 201) {
      const parsed = uploadedMediaSchema.safeParse(value);
      if (parsed.success && parsed.data.kind === kind) return { ok: true, data: parsed.data };
    } else if (typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" && mediaErrorStatuses[value.code] === response.status) {
      return { ok: false, status: response.status, code: value.code };
    } else if (kind === HERO_VIDEO_KIND && VIDEO_FALLBACK_CODES[response.status]) {
      return { ok: false, status: response.status, code: VIDEO_FALLBACK_CODES[response.status] };
    }
    return { ok: false, status: 502, code: "unrecognized_response" };
  } catch { return { ok: false, status: 503, code: "no_response" }; }
  finally { if (timer) clearTimeout(timer); }
}
/** Image upload: a multipart form rebuilt by the route. */
export function uploadMediaFile(token: string, body: FormData, kind: UploadKindV2): Promise<MediaBackendResult> {
  return postMedia(token, { body }, kind);
}
/** Streamed upload (hero video): an already framed multipart stream and its content type. */
export function uploadMediaStream(token: string, body: ReadableStream<Uint8Array>, contentType: string, kind: UploadKindV2): Promise<MediaBackendResult> {
  return postMedia(token, { body, contentType }, kind);
}
