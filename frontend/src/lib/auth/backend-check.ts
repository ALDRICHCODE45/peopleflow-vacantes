import "server-only";
import { requestJson } from "@/lib/api/server";

export type PrivateBackendSession = { accessToken: string | null; cookies: string[] };
type CheckCode = "unauthenticated" | "not_found" | "backend_unavailable" | "invalid_backend_response" | "backend_timeout" | "authentication_unavailable";

type AuthDiagnostic = "frontend_session_unavailable" | "backend_token_rejected" | "backend_user_not_found" | "backend_auth_unknown";

export function checkResponse(status: number, code?: CheckCode, cookies: string[] = [], diagnostic?: AuthDiagnostic): Response {
  const headers = new Headers({ "cache-control": "no-store", "vary": "Cookie" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  const body = code ? { ok: false, code, ...(diagnostic ? { diagnostic } : {}) } : { ok: true };
  return Response.json(body, { status, headers });
}

/** The agreed exact Go envelopes identify a stage, not permission to provision. */
function decodeAuthDiagnostic(value: unknown): AuthDiagnostic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "backend_auth_unknown";
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || data.code !== "unauthenticated") return "backend_auth_unknown";
  if (data.error === "unauthorized") return "backend_token_rejected";
  if (data.error === "unauthenticated") return "backend_user_not_found";
  return "backend_auth_unknown";
}

function decodeCompanyCheck(value: unknown): true {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid company response");
  const data = value as Record<string, unknown>;
  if (typeof data.company_id !== "string" || typeof data.role !== "string" ||
    typeof data.company !== "object" || data.company === null || Array.isArray(data.company)) throw new Error("Invalid company response");
  const company = data.company as Record<string, unknown>;
  for (const key of ["id", "name", "rfc", "industry_id", "status"]) {
    if (typeof company[key] !== "string") throw new Error("Invalid company response");
  }
  return true;
}

/** A fixed, read-only diagnostic: no upstream bodies, identifiers or headers escape. */
export async function backendCheck(
  env: { apiBaseUrl: string; apiTimeoutMs: number },
  resolveSession: () => Promise<PrivateBackendSession>,
): Promise<Response> {
  let session: PrivateBackendSession;
  try {
    session = await resolveSession();
  } catch {
    return checkResponse(503, "authentication_unavailable");
  }
  const { accessToken, cookies } = session;
  if (!accessToken || /\s/.test(accessToken)) return checkResponse(401, "unauthenticated", cookies, "frontend_session_unavailable");
  const result = await requestJson(`${env.apiBaseUrl}/me/company`, {
    decoder: decodeCompanyCheck,
    timeoutMs: env.apiTimeoutMs,
    expectedStatus: 200,
    redirect: "error",
    headers: { authorization: `Bearer ${accessToken}` },
    errorDecoder: decodeAuthDiagnostic,
    maxErrorBodyBytes: 512,
  });
  if (result.ok) return checkResponse(200, undefined, cookies);
  if (result.error.kind === "status" && result.error.status === 401)
    return checkResponse(401, "unauthenticated", cookies, result.envelope ?? "backend_auth_unknown");
  if (result.error.kind === "status" && result.error.status === 404)
    return checkResponse(404, "not_found", cookies);
  if (result.error.kind === "timeout") return checkResponse(504, "backend_timeout", cookies);
  if (result.error.kind === "invalid_response") return checkResponse(502, "invalid_backend_response", cookies);
  return checkResponse(502, "backend_unavailable", cookies);
}
