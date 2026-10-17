import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadCvs } from "@/features/candidate-cvs/client";
import { uploadFile } from "@/features/candidate-cvs/file-client";
import { cvFailure } from "@/features/candidate-cvs/failure";
import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { acceptedCvFile, normalizeCvName, validCvName } from "@/features/candidate-cvs/model";
import { routeError, routeFailure } from "@/features/candidate-cvs/route-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A bounded multipart envelope is additional to the advertised FILE byte limit.
// This admits a full 5 MiB CV but cannot buffer arbitrarily large names/headers/unknown parts.
const MULTIPART_OVERHEAD = 16_384;
export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return routeError(403, "forbidden");
    const token = await getActionAccessToken();
    if (!token) return routeError(401, "unauthenticated");
    // This candidate-only resource is also the authority for current upload limits.
    const library = await loadCvs({ token });
    if (!library.ok) return routeFailure(cvFailure(library));
    const limits = library.data.limits;
    const cap = limits.max_bytes + MULTIPART_OVERHEAD;
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) return routeError(400, "invalid_request");
    if (contentLength && Number(contentLength) > cap) return routeError(413, "cv_too_large");
    const type = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256) return routeError(400, "invalid_request");
    let data: FormData;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try {
      const bytes = await readBoundedBody(request.body, cap, signal);
      data = await new Response(bytes, { headers: { "content-type": type } }).formData();
    } catch (error) { return routeError(error instanceof BodyTooLarge ? 413 : 400, error instanceof BodyTooLarge ? "cv_too_large" : "invalid_request"); }
    const keys = [...data.keys()];
    const files = data.getAll("file"); const names = data.getAll("name");
    if (keys.some(key => key !== "file" && key !== "name") || files.length !== 1 || typeof files[0] === "string" || names.length > 1 || (names.length === 1 && typeof names[0] !== "string")) return routeError(400, "invalid_request");
    const file = files[0] as File;
    if (file.size > limits.max_bytes) return routeError(413, "cv_too_large");
    if (file.size === 0) return routeError(400, "invalid_request");
    if (!acceptedCvFile(file, limits)) return routeError(415, "cv_unsupported_type");
    const name = names.length ? normalizeCvName(names[0] as string) : undefined;
    if (name !== undefined && !validCvName(name)) return routeError(400, "invalid_request");
    const forwarded = new FormData();
    // Drop any path from a browser-supplied filename; never use it to construct a URL or local path.
    const filename = file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "") || "cv";
    forwarded.append("file", file, filename);
    if (name !== undefined) forwarded.append("name", name);
    const result = await uploadFile(token, forwarded, limits);
    return result.ok ? Response.json(result.data, { status: 201, headers: { "cache-control": "no-store" } }) : routeFailure(cvFailure(result));
  } catch { return routeError(503, "no_response"); }
}
