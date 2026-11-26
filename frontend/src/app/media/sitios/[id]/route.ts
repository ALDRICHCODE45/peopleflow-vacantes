import { z } from "zod";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";
// video/mp4: the careers hero background video (slice B), served in byte ranges.
const safeTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);
/** One satisfiable-looking byte range only; anything else is dropped (the upstream answers 200). */
const RANGE = /^bytes=(?:\d{1,15}-\d{0,15}|-\d{1,15})$/;
const CONTENT_RANGE = /^bytes (?:\d{1,15}-\d{1,15}|\*)\/(?:\d{1,15}|\*)$/;
const DIGITS = /^\d{1,15}$/;
const failure = (status: number, cache: string | null = null) => new Response(null, {
  status, headers: { "X-Content-Type-Options": "nosniff", ...(cache ? { "Cache-Control": cache } : {}) },
});

/** Anonymous capability proxy. Never copy request headers or expose the API origin. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return failure(404);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), serverEnv.apiTimeoutMs);
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
      return new Response(null, { status: 416, headers: { "X-Content-Type-Options": "nosniff", ...(CONTENT_RANGE.test(contentRange) ? { "Content-Range": contentRange } : {}) } });
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
