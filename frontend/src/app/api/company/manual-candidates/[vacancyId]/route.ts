import { getActionAccessToken } from "@/lib/auth/action-session";
import { BodyTooLarge, boundedJson, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { acceptedCvFile, HARD_MAX_BYTES } from "@/features/candidate-cvs/model";
import { uuidSchema } from "@/features/pipeline-movement/model";
import { forwardManualIntake } from "@/features/manual-intake/file-client";
import { cvLimits, errorSchema, intakeBodySchema, intakeResponseSchema } from "@/features/manual-intake/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 64 KiB accommodates the bounded profile JSON, headers and multipart framing.
const CAP = HARD_MAX_BYTES + 65_536;
const error = (status: number, code: string) => Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request, context: { params: Promise<{ vacancyId: string }> }): Promise<Response> {
 try {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return error(403, "forbidden");
  const token = await getActionAccessToken(); if (!token) return error(401, "unauthenticated");
  const { vacancyId } = await context.params;
  const key = request.headers.get("idempotency-key");
  if (!uuidSchema.safeParse(vacancyId).success || !uuidSchema.safeParse(key).success) return error(400, "invalid_request");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return error(400, "invalid_request");
  if (length && Number(length) > CAP) return error(413, "cv_too_large");
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256) return error(400, "invalid_request");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let form: FormData;
  try { const bytes = await readBoundedBody(request.body, CAP, signal); form = await new Response(bytes, { headers: { "content-type": type } }).formData(); }
  catch (cause) { return error(cause instanceof BodyTooLarge ? 413 : 400, cause instanceof BodyTooLarge ? "cv_too_large" : "invalid_request"); }
  if ([...form.keys()].some(key => key !== "data" && key !== "cv") || form.getAll("data").length !== 1 || form.getAll("cv").length !== 1) return error(400, "invalid_request");
  const json = form.get("data"), cv = form.get("cv");
  if (typeof json !== "string" || typeof cv === "string" || cv === null || json.length > 65_536) return error(400, "invalid_request");
  let data: unknown; try { data = JSON.parse(json); } catch { return error(400, "invalid_request"); }
  const parsed = intakeBodySchema.safeParse(data); if (!parsed.success) return error(400, "invalid_request");
  if (cv.size > HARD_MAX_BYTES) return error(413, "cv_too_large");
  if (!cv.size) return error(400, "invalid_request");
  if (!acceptedCvFile(cv, cvLimits)) return error(415, "cv_unsupported_type");
  const body = new FormData(); body.append("data", JSON.stringify(parsed.data));
  body.append("cv", cv, cv.name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "") || "cv");
  const response = await forwardManualIntake(token, vacancyId, key!, body, signal);
  let value: unknown; try { value = await boundedJson(response, 131_072, signal); } catch { return error(502, "unrecognized_response"); }
  const headers = new Headers({ "cache-control": "no-store" });
  if (response.status === 201) {
   const result = intakeResponseSchema.safeParse(value); if (!result.success) return error(502, "unrecognized_response");
   const etag = response.headers.get("etag"); if (etag && etag !== result.data.etag) return error(502, "unrecognized_response");
   if (etag) headers.set("etag", etag);
   const replayed = response.headers.get("idempotency-replayed"); if (replayed === "true" || replayed === "false") headers.set("idempotency-replayed", replayed);
   return Response.json(result.data, { status: 201, headers });
  }
  const failure = errorSchema.safeParse(value);
  if (!failure.success || response.status < 400 || response.status > 599) return error(502, "unrecognized_response");
  // Only the contracted code, field issues and known data keys reach the browser; the backend's
  // human-readable message is replaced by its code, like the CV route.
  const { code, fields, data: failureData } = failure.data;
  const known = failureData && { ...(failureData.matches ? { matches: failureData.matches } : {}), ...(failureData.participation_id ? { participation_id: failureData.participation_id } : {}) };
  return Response.json({ error: code, code, ...(fields ? { fields } : {}), ...(known && Object.keys(known).length ? { data: known } : {}) }, { status: response.status, headers });
 } catch { return error(503, "no_response"); }
}
