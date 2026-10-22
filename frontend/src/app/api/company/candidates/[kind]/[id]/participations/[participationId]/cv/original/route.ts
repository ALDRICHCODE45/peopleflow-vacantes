import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { cvFailure } from "@/features/candidate-cvs/failure";
import { routeError, routeFailure } from "@/features/candidate-cvs/route-response";
import { uuidSchema } from "@/features/pipeline-movement/model";
import { orgCandidateIdentitySchema } from "@/features/org-candidates/detail/detail-model";
import { downloadOrgCandidateCv } from "@/features/org-candidates/detail/file-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Same pool authorization and streaming boundary as the current CV; only the fixed suffix differs. */
export async function GET(_request: Request, context: { params: Promise<{ kind: string; id: string; participationId: string }> }): Promise<Response> {
 try {
  const token = await getActionAccessToken();
  if (!token?.trim()) return routeError(401, "unauthenticated");
  const { kind, id, participationId } = await context.params;
  const candidate = orgCandidateIdentitySchema.safeParse({ kind, id });
  if (!candidate.success || !uuidSchema.safeParse(participationId).success) return routeError(404, "not_found");
  const me = await loadMe({ token });
  if (!me.ok) return routeFailure(cvFailure(me));
  if (me.data.role !== "recruiter") return routeError(403, "forbidden");
  const result = await downloadOrgCandidateCv(token, candidate.data, participationId, "original");
  if (!result.ok) return routeFailure(cvFailure(result));
  return new Response(result.data.body, { status: 200, headers: {
   "cache-control": "no-store", "content-type": result.data.contentType,
   "content-disposition": result.data.disposition, "x-content-type-options": "nosniff",
  } });
 } catch { return routeError(503, "no_response"); }
}
