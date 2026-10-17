import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "@/features/identity/me-client";
import { downloadFile } from "@/features/candidate-cvs/file-client";
import { cvFailure } from "@/features/candidate-cvs/failure";
import { uuidSchema } from "@/features/candidate-cvs/model";
import { routeError, routeFailure } from "@/features/candidate-cvs/route-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const token = await getActionAccessToken();
    if (!token) return routeError(401, "unauthenticated");
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) return routeError(404, "not_found");
    const identity = await loadMe({ token });
    if (!identity.ok) return routeFailure(cvFailure(identity));
    if (identity.data.role !== "candidate") return routeError(403, identity.data.role === "recruiter" ? "wrong_role" : "forbidden");
    const result = await downloadFile(token, id);
    if (!result.ok) return routeFailure(cvFailure(result));
    return new Response(result.data.body, { status: 200, headers: {
      "cache-control": "no-store", "content-type": result.data.contentType,
      "content-disposition": result.data.disposition, "x-content-type-options": "nosniff",
    } });
  } catch { return routeError(503, "no_response"); }
}
