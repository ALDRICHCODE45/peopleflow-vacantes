import { getActionAccessToken } from "@/lib/auth/action-session";
import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { uploadMediaFile, uploadMediaStream } from "@/features/company-site/api/file-client";
import { HERO_VIDEO_KIND, HERO_VIDEO_MAX_BYTES, HERO_VIDEO_TYPE, LOGO_MEDIA_TYPES, MEDIA_MAX_BYTES, MEDIA_TYPES, mediaKindSchema, mediaKindSchemaV2 } from "@/features/company-site/media";
import { SECTIONS_V2_ENABLED } from "@/features/company-site/sections-v2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same bounded multipart allowance as the candidate CV route: 5 MiB plus 16 KiB framing.
const CAP = MEDIA_MAX_BYTES + 16_384;
const error = (status: number, code: string) => Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store" } });
const encoder = new TextEncoder();
/**
 * Slice B hero video: the browser sends the raw MP4 (`?kind=hero_video`, `Content-Type: video/mp4`)
 * and it is streamed to the backend inside a multipart frame built here, so the route never holds
 * the 20 MB in memory and the kind/filename/part type are fixed server-side. Actual bytes are
 * counted; the backend still validates the MP4 structure and duration. App Router handlers have no
 * body size limit and the middleware matcher doesn't cover this path (no 10 MB clone limit).
 */
async function postVideo(request: Request, token: string, length: string | null): Promise<Response> {
  if (!SECTIONS_V2_ENABLED) return error(400, "invalid_request");
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== HERO_VIDEO_TYPE) return error(415, "unsupported_media_type");
  if (length && Number(length) > HERO_VIDEO_MAX_BYTES) return error(413, "payload_too_large");
  if (!request.body || length === "0") return error(400, "invalid_request");
  const boundary = `peopleflow-${crypto.randomUUID()}`;
  const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${HERO_VIDEO_KIND}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: ${HERO_VIDEO_TYPE}\r\n\r\n`);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = request.body.getReader();
  let bytes = 0;
  let tooLarge = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(head); },
    async pull(stream) {
      const chunk = await reader.read();
      if (chunk.done) {
        if (bytes === 0) { stream.error(new Error("Empty body")); return; }
        stream.enqueue(tail); stream.close(); return;
      }
      bytes += chunk.value.byteLength;
      if (bytes > HERO_VIDEO_MAX_BYTES) { tooLarge = true; void reader.cancel().catch(() => {}); stream.error(new BodyTooLarge()); return; }
      stream.enqueue(chunk.value);
    },
    async cancel(reason) { await reader.cancel(reason).catch(() => {}); },
  });
  const result = await uploadMediaStream(token, body, `multipart/form-data; boundary=${boundary}`, HERO_VIDEO_KIND);
  if (tooLarge) return error(413, "payload_too_large");
  if (!result.ok && bytes === 0) return error(400, "invalid_request");
  return result.ok ? Response.json(result.data, { status: 201, headers: { "cache-control": "no-store" } }) : error(result.status, result.code);
}
export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return error(403, "forbidden");
    const token = await getActionAccessToken();
    if (!token?.trim()) return error(401, "unauthenticated");
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return error(400, "invalid_request");
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "kind") || query.getAll("kind").length > 1) return error(400, "invalid_request");
    if (query.has("kind")) return query.get("kind") === HERO_VIDEO_KIND ? await postVideo(request, token, length) : error(400, "invalid_request");
    if (length && Number(length) > CAP) return error(413, "payload_too_large");
    const type = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256) return error(400, "invalid_request");
    let form: FormData;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try {
      const bytes = await readBoundedBody(request.body, CAP, signal);
      form = await new Response(bytes, { headers: { "content-type": type } }).formData();
    } catch (cause) { return error(cause instanceof BodyTooLarge ? 413 : 400, cause instanceof BodyTooLarge ? "payload_too_large" : "invalid_request"); }
    if ([...form.keys()].some(key => key !== "kind" && key !== "file") || form.getAll("kind").length !== 1 || form.getAll("file").length !== 1) return error(400, "invalid_request");
    // `logo` exists only with sections v2 (backend slice A); until then it is an unknown kind.
    const kind = (SECTIONS_V2_ENABLED ? mediaKindSchemaV2 : mediaKindSchema).safeParse(form.get("kind"));
    const file = form.get("file");
    if (!kind.success || file === null || typeof file === "string" || !file.size) return error(400, "invalid_request");
    if (file.size > MEDIA_MAX_BYTES) return error(413, "payload_too_large");
    // Logos keep their transparency: PNG/WebP only.
    if (!((kind.data === "logo" ? LOGO_MEDIA_TYPES : MEDIA_TYPES) as readonly string[]).includes(file.type)) return error(415, "unsupported_media_type");
    const body = new FormData(); body.append("kind", kind.data);
    const filename = file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "") || "image";
    body.append("file", file, filename);
    const result = await uploadMediaFile(token, body, kind.data);
    return result.ok ? Response.json(result.data, { status: 201, headers: { "cache-control": "no-store" } }) : error(result.status, result.code);
  } catch { return error(503, "no_response"); }
}
