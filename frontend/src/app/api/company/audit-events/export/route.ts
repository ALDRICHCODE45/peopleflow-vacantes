import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { exportAuditCsv, type AuditClientFailure } from "@/features/audit-log/client";
import { parseExportBody } from "@/features/audit-log/model";
import { getActionAccessToken } from "@/lib/auth/action-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8192;
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** Errors are JSON with a code, never the backend's text; `extra` carries only fields the contract defines. */
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, code, ...extra }, { status, headers: HEADERS });

function failure({ error, envelope }: AuditClientFailure): Response {
  const status = error.status;
  if (error.kind === "missing_token" || status === 401) return problem(401, "unauthenticated");
  if (error.kind === "invalid_request") return problem(400, "invalid_request");
  if (status === 403) return problem(403, "forbidden");
  if (status === 422 && envelope?.code === "audit_export_too_large") {
    return problem(422, "audit_export_too_large", envelope.row_count !== undefined && envelope.limit !== undefined ? { row_count: envelope.row_count, limit: envelope.limit } : {});
  }
  if (status === 422 && envelope?.code === "invalid_filter") return problem(422, "invalid_filter", envelope.fields ? { fields: envelope.fields } : {});
  if (status !== undefined && status >= 500 && status < 600) return problem(502, "server_error");
  if (error.kind === "network" || error.kind === "timeout") return problem(503, "no_response");
  return problem(502, "unrecognized_response");
}

/**
 * Owner-only audit export (contract §8.5, D7). The API decides every error before the first byte, so a 200 here is the
 * CSV itself, streamed without buffering; the browser downloads it only on that 200.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return problem(403, "forbidden");
    const token = await getActionAccessToken();
    if (!token?.trim()) return problem(401, "unauthenticated");
    const length = request.headers.get("content-length");
    if (length !== null && !/^\d+$/.test(length)) return problem(400, "invalid_request");
    if (length !== null && Number(length) > MAX_BODY_BYTES) return problem(413, "payload_too_large");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request.body, MAX_BODY_BYTES, request.signal))); }
    catch (cause) { return cause instanceof BodyTooLarge ? problem(413, "payload_too_large") : problem(400, "invalid_request"); }
    const body = parseExportBody(value);
    if (!body.ok) return problem(422, "invalid_filter", { fields: body.fields });
    const result = await exportAuditCsv(token, body.data);
    if (!result.ok) return failure(result);
    return new Response(result.data.body, { status: 200, headers: { ...HEADERS, "content-type": result.data.contentType, "content-disposition": result.data.disposition } });
  } catch { return problem(503, "no_response"); }
}
