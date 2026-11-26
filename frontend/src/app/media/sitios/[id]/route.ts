import { z } from "zod";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";
// video/mp4: the careers hero background video (slice B), served in byte ranges.
const safeTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);
/** One byte range (`N-M`, `N-`, `-K`) is forwarded as is — the upstream decides 206, 200 (e.g. `bytes=-0`,
 * last < first) or 416. Several ranges, another unit or a malformed spec are dropped: the upstream would
 * ignore them and answer 200 with the whole file anyway (RFC 9110 §14.2). */
const RANGE = /^bytes=(?:\d{1,15}-\d{0,15}|-\d{1,15})$/;
const CONTENT_RANGE = /^bytes (?:\d{1,15}-\d{1,15}|\*)\/(?:\d{1,15}|\*)$/;
const DIGITS = /^\d{1,15}$/;
/** apiTimeoutMs bounds the response headers (and image bodies); a hero video body may stream for
 * minutes (slow links, a 20 MB full-file 200), so it gets a long deadline instead. */
const VIDEO_BODY_TIMEOUT_MS = 180_000;
const failure = (status: number, cache: string | null = null) => new Response(null, {
  status, headers: { "X-Content-Type-Options": "nosniff", ...(cache ? { "Cache-Control": cache } : {}) },
});

/** Anonymous capability proxy. Never copy request headers or expose the API origin. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return failure(404);
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), serverEnv.apiTimeoutMs);
  try {
    const apiOrigin = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`/v2/company-sites/media/${id}`, apiOrigin);
    // The server-configured API origin is the sole allowed outbound host.
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== apiOrigin.origin || url.username || url.password) {
      clearTimeout(timer);
      return failure(502);
    }
    // Range is the only request header that crosses: validated, never copied wholesale.
    const range = request.headers.get("range")?.trim() ?? "";
    const upstream = await fetch(new Request(url.toString(), {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
      ...(RANGE.test(range) ? { headers: { range } } : {}),
    }));
    const contentRange = upstream.headers.get("content-range") ?? "";
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      clearTimeout(timer);
      // Never cacheable, whatever the upstream said; empty body.
      return new Response(null, { status: 416, headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...(CONTENT_RANGE.test(contentRange) ? { "Content-Range": contentRange } : {}) } });
    }
    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel();
      clearTimeout(timer);
      return upstream.status === 404 ? failure(404, upstream.headers.get("cache-control")) : failure(502);
    }
    const type = upstream.headers.get("content-type") ?? "";
    if (!safeTypes.has(type) || !upstream.body || (upstream.status === 206 && !CONTENT_RANGE.test(contentRange))) {
      await upstream.body?.cancel();
      clearTimeout(timer);
      return failure(502);
    }
    const headers = new Headers({ "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    const cache = upstream.headers.get("cache-control");
    if (cache) headers.set("Cache-Control", cache);
    if (upstream.status === 206) headers.set("Content-Range", contentRange);
    if (upstream.headers.get("accept-ranges") === "bytes") headers.set("Accept-Ranges", "bytes");
    const length = upstream.headers.get("content-length") ?? "";
    if (DIGITS.test(length)) headers.set("Content-Length", length);
    if (type === "video/mp4") { clearTimeout(timer); timer = setTimeout(() => controller.abort(), VIDEO_BODY_TIMEOUT_MS); }
    const reader = upstream.body.getReader();
    // Keep the deadline alive through body consumption, not just response headers.
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { clearTimeout(timer); stream.close(); }
          else stream.enqueue(chunk.value);
        } catch (error) { clearTimeout(timer); stream.error(error); }
      },
      async cancel(reason) { clearTimeout(timer); controller.abort(); await reader.cancel(reason); },
    });
    return new Response(body, { status: upstream.status, headers });
  } catch {
    clearTimeout(timer);
    return failure(502);
  }
}
