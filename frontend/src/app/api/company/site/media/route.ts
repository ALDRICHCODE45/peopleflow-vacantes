import { getActionAccessToken } from "@/lib/auth/action-session";
import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { uploadMediaFile } from "@/features/company-site/api/file-client";
import { MEDIA_MAX_BYTES, MEDIA_TYPES, mediaKindSchema } from "@/features/company-site/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same bounded multipart allowance as the candidate CV route: 5 MiB plus 16 KiB framing.
const CAP = MEDIA_MAX_BYTES + 16_384;
const error = (status: number, code: string) => Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return error(403, "forbidden");
    const token = await getActionAccessToken();
    if (!token?.trim()) return error(401, "unauthenticated");
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return error(400, "invalid_request");
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
    const kind = mediaKindSchema.safeParse(form.get("kind"));
    const file = form.get("file");
    if (!kind.success || file === null || typeof file === "string" || !file.size) return error(400, "invalid_request");
    if (file.size > MEDIA_MAX_BYTES) return error(413, "payload_too_large");
    if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) return error(415, "unsupported_media_type");
    const body = new FormData(); body.append("kind", kind.data);
    const filename = file.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "") || "image";
    body.append("file", file, filename);
    const result = await uploadMediaFile(token, body, kind.data);
    return result.ok ? Response.json(result.data, { status: 201, headers: { "cache-control": "no-store" } }) : error(result.status, result.code);
  } catch { return error(503, "no_response"); }
}
