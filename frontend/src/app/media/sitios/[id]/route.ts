import { z } from "zod";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";
const safeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const failure = (status: number, cache: string | null = null) => new Response(null, {
  status, headers: { "X-Content-Type-Options": "nosniff", ...(cache ? { "Cache-Control": cache } : {}) },
});

/** Anonymous capability proxy. Never copy request headers or expose the API origin. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const upstream = await fetch(new Request(url.toString(), {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
    }));
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      clearTimeout(timer);
      return upstream.status === 404 ? failure(404, upstream.headers.get("cache-control")) : failure(502);
    }
    const type = upstream.headers.get("content-type") ?? "";
    if (!safeTypes.has(type) || !upstream.body) {
      await upstream.body?.cancel();
      clearTimeout(timer);
      return failure(502);
    }
    const headers = new Headers({ "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    const cache = upstream.headers.get("cache-control");
    if (cache) headers.set("Cache-Control", cache);
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
    return new Response(body, { status: 200, headers });
  } catch {
    clearTimeout(timer);
    return failure(502);
  }
}
