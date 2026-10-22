import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { HARD_MAX_BYTES, acceptedCvFile } from "@/features/candidate-cvs/model";
import { etagSchema } from "@/features/pipeline-movement/model";
import { saveOrgCandidateCvAction } from "@/features/org-candidates/cv/cv-actions";
import { cvLimits, CV_ENVELOPE_CAP } from "@/features/org-candidates/cv/cv-model";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { cvFailure } from "@/features/candidate-cvs/failure";
import { routeError, routeFailure } from "@/features/candidate-cvs/route-response";
import { uuidSchema } from "@/features/pipeline-movement/model";
import { orgCandidateIdentitySchema } from "@/features/org-candidates/detail/detail-model";
import { downloadOrgCandidateCv } from "@/features/org-candidates/detail/file-client";
export const runtime = "nodejs";
const uploadError = (status: number, code: string) => Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store" } });
/** Binary goes through this bounded boundary, not the Server Action request body. */
export async function POST(request: Request, context: { params: Promise<{ kind: string; id: string; participationId: string }> }): Promise<Response> {
 try {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return routeError(403, "forbidden");
  if (!(await getActionAccessToken())?.trim()) return routeError(401, "unauthenticated");
  const { kind, id, participationId } = await context.params;
  const candidate = orgCandidateIdentitySchema.safeParse({ kind, id });
  if (!candidate.success || !uuidSchema.safeParse(participationId).success) return routeError(404, "not_found");
  const etag = request.headers.get("if-match");
  if (!etag) return uploadError(428, "precondition_required");
  if (!etagSchema.safeParse(etag).success) return routeError(400, "invalid_request");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return routeError(400, "invalid_request");
  if (length && Number(length) > CV_ENVELOPE_CAP) return routeError(413, "cv_too_large");
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256) return routeError(400, "invalid_request");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let form: FormData;
  try {
   const bytes = await readBoundedBody(request.body, CV_ENVELOPE_CAP, signal);
   form = await new Response(bytes, { headers: { "content-type": type } }).formData();
  } catch (cause) { return routeError(cause instanceof BodyTooLarge ? 413 : 400, cause instanceof BodyTooLarge ? "cv_too_large" : "invalid_request"); }
  if ([...form.keys()].some(key => key !== "cv") || form.getAll("cv").length !== 1) return routeError(400, "invalid_request");
  const cv = form.get("cv");
  if (cv === null || typeof cv === "string" || !cv.size) return uploadError(400, "validation_error");
  if (cv.size > HARD_MAX_BYTES) return routeError(413, "cv_too_large");
  if (!acceptedCvFile(cv, cvLimits)) return routeError(415, "cv_unsupported_type");
  const result = await saveOrgCandidateCvAction(candidate.data, participationId, etag, cv);
  if (!result.ok) return uploadError(result.reference.status ?? 503, result.reference.code ?? result.reason);
  return Response.json(result.data, { status: 200, headers: { "cache-control": "no-store", etag: result.data.etag } });
 } catch { return routeError(503, "no_response"); }
}
export const dynamic = "force-dynamic";
/** Organization pool CV: every recruiter of the company may download it, unlike the board's principal-only route. */
export async function GET(_request: Request, context: { params: Promise<{ kind: string; id: string; participationId: string }> }): Promise<Response> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return routeError(401, "unauthenticated");
    const { kind, id, participationId } = await context.params;
    const candidate = orgCandidateIdentitySchema.safeParse({ kind, id });
    if (!candidate.success || !uuidSchema.safeParse(participationId).success) return routeError(404, "not_found");
    const identity = await loadMe({ token });
    if (!identity.ok) return routeFailure(cvFailure(identity));
    if (identity.data.role !== "recruiter") return routeError(403, "forbidden");
    const result = await downloadOrgCandidateCv(token, candidate.data, participationId);
    if (!result.ok) return routeFailure(cvFailure(result));
    return new Response(result.data.body, { status: 200, headers: {
      "cache-control": "no-store", "content-type": result.data.contentType,
      "content-disposition": result.data.disposition, "x-content-type-options": "nosniff",
    } });
  } catch { return routeError(503, "no_response"); }
}
