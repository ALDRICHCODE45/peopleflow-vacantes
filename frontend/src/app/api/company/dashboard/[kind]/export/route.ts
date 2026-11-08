import type { MetricsClientFailure } from "@/features/company-metrics/client";
import { dashboardApiQuery, isDashboardListKind, parseDashboardDetail } from "@/features/employer-dashboard/detail/query";
import { exportDashboardList } from "@/features/employer-dashboard/export-client";
import { getActionAccessToken } from "@/lib/auth/action-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const rows = new Intl.NumberFormat("es-MX");

/** Errors are JSON with a code, never the backend's text; `extra` carries only fields the contract defines. */
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, code, ...extra }, { status, headers: HEADERS });

function failure({ error, envelope }: MetricsClientFailure): Response {
  const status = error.status;
  if (error.kind === "missing_token" || status === 401) return problem(401, "unauthenticated");
  if (error.kind === "invalid_request") return problem(404, "not_found");
  if (status === 403) return problem(403, "forbidden");
  if (status === 422 && envelope?.code === "metrics_export_too_large") {
    const limit = envelope.limit ?? 50_000;
    return problem(422, "metrics_export_too_large", {
      message: `Son más de ${rows.format(limit)} filas: acota los filtros`,
      ...(envelope.row_count !== undefined && envelope.limit !== undefined ? { row_count: envelope.row_count, limit: envelope.limit } : {}),
    });
  }
  if (status === 422 && envelope?.code === "invalid_filter") return problem(422, "invalid_filter", envelope.fields ? { fields: envelope.fields } : {});
  if (status !== undefined && status >= 500 && status < 600) return problem(502, "server_error");
  if (error.kind === "network" || error.kind === "timeout") return problem(503, "no_response");
  return problem(502, "unrecognized_response");
}

/**
 * «Exportar CSV» of the dashboard detail page (contract `company-dashboard-v2` §5): the same validated query and window
 * as the list, without cursor or limit, streamed from the API with the session token (scope forced by role, not
 * audited). Hardened like the metrics export: POST only, so SameSite=Lax keeps the session cookie off any cross-site
 * navigation or subresource, with the Origin/Sec-Fetch-Site check as a second layer.
 */
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return problem(403, "forbidden");
    const { kind } = await context.params;
    if (!isDashboardListKind(kind)) return problem(404, "not_found");
    // The path decides the kind; a `kind` in the query never overrides it.
    const search = new URLSearchParams(new URL(request.url).searchParams);
    search.set("kind", kind);
    const state = parseDashboardDetail(search);
    if (!state || state.kind !== kind) return problem(404, "not_found");
    const token = await getActionAccessToken();
    if (!token?.trim()) return problem(401, "unauthenticated");
    const result = await exportDashboardList(token, state.kind, dashboardApiQuery(state));
    if (!result.ok) return failure(result);
    return new Response(result.data.body, { status: 200, headers: { ...HEADERS, "content-type": result.data.contentType, "content-disposition": result.data.disposition } });
  } catch { return problem(503, "no_response"); }
}
