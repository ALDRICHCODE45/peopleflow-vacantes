import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { cvFailure } from "@/features/candidate-cvs/failure";
import { routeError, routeFailure } from "@/features/candidate-cvs/route-response";
import { downloadParticipationCv } from "@/features/pipeline-movement/file-client";
import { uuidSchema } from "@/features/pipeline-movement/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ vacancyId: string; participationId: string }> }): Promise<Response> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return routeError(401, "unauthenticated");
    const { vacancyId, participationId } = await context.params;
    if (!uuidSchema.safeParse(vacancyId).success || !uuidSchema.safeParse(participationId).success) return routeError(404, "not_found");
    const identity = await loadMe({ token });
    if (!identity.ok) return routeFailure(cvFailure(identity));
    if (identity.data.role !== "recruiter") return routeError(403, "forbidden");
    const result = await downloadParticipationCv(token, vacancyId, participationId);
    if (!result.ok) return routeFailure(cvFailure(result));
    return new Response(result.data.body, { status: 200, headers: {
      "cache-control": "no-store", "content-type": result.data.contentType,
      "content-disposition": result.data.disposition, "x-content-type-options": "nosniff",
    } });
  } catch { return routeError(503, "no_response"); }
}
