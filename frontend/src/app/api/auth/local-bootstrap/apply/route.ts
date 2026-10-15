import type { NextRequest } from "next/server";
import { LOCAL_BOOTSTRAP_APPLY_BODY_MAX_BYTES, parseApplyRequest, readBoundedRequestBody } from "@/lib/auth/local-bootstrap/body";
import { applyLocalIdentity } from "@/lib/auth/local-bootstrap/client";
import { isTrustedOrigin, validateLocalBootstrapEnv } from "@/lib/auth/local-bootstrap/config";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, isCsrfValid, verifyCsrfToken } from "@/lib/auth/local-bootstrap/csrf";
import { OPERATION_COOKIE_NAME, verifyOperationBinding } from "@/lib/auth/local-bootstrap/operation";
import {
  LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS,
  bootstrapJsonResponse,
  errorBody,
} from "@/lib/auth/local-bootstrap/respond";
import { resolveLocalBootstrapSession } from "@/lib/auth/local-bootstrap/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit apply action after the human approved the operation in the private
 * local terminal. It resolves the CURRENT private session again, accepts only
 * `{"operation_code":"..."}` (no browser-supplied identity, profile or target),
 * and requires the transaction cookie minted by the successful stage to still
 * match the current access, the current CSRF nonce and this exact operation.
 * A missing, tampered, foreign or expired binding fails closed with zero Go
 * calls. The binding is never consumed on the frontend, so an explicit apply
 * may be repeated with the same operation after `409 approval_required` while
 * its short TTL is valid.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const state = validateLocalBootstrapEnv(process.env);
  if (state.status !== "enabled") return unavailable();
  const { config } = state;

  if (!isTrustedOrigin(request.headers.get("origin"), config.trustedOrigin)) {
    return bootstrapJsonResponse(403, errorBody("bootstrap_forbidden"));
  }

  let session;
  try {
    session = await resolveLocalBootstrapSession(request);
  } catch {
    return unavailable();
  }
  if (!session.accessToken) {
    return bootstrapJsonResponse(401, errorBody("unauthenticated"), session.cookies);
  }

  const csrf = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? "";
  if (
    !isCsrfValid(csrf, request.headers.get(CSRF_HEADER_NAME)) ||
    !verifyCsrfToken(config.csrfSecret, session.accessToken, csrf)
  ) {
    return bootstrapJsonResponse(403, errorBody("bootstrap_forbidden"), session.cookies);
  }

  const raw = await readBoundedRequestBody(request, LOCAL_BOOTSTRAP_APPLY_BODY_MAX_BYTES);
  const parsed = raw === null ? null : parseApplyRequest(raw);
  if (parsed === null) {
    return bootstrapJsonResponse(400, errorBody("invalid_request"), session.cookies);
  }

  const operationToken = request.cookies.get(OPERATION_COOKIE_NAME)?.value;
  const binding = verifyOperationBinding(
    config.csrfSecret,
    session.accessToken,
    csrf,
    parsed.operation_code,
    operationToken,
  );
  if (binding === "expired") {
    return bootstrapJsonResponse(410, errorBody("operation_expired"), session.cookies);
  }
  if (binding !== "valid") {
    return bootstrapJsonResponse(403, errorBody("bootstrap_forbidden"), session.cookies);
  }

  const outcome = await applyLocalIdentity(config, session.accessToken, parsed.operation_code);
  if (outcome.kind === "success") {
    return bootstrapJsonResponse(200, { ok: true, code: outcome.data.code }, session.cookies);
  }
  if (outcome.kind === "error") {
    return bootstrapJsonResponse(outcome.status, errorBody(outcome.code), session.cookies);
  }
  return bootstrapJsonResponse(500, errorBody("bootstrap_failed"), session.cookies);
}

function unavailable(): Response {
  return bootstrapJsonResponse(
    LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS,
    errorBody("local_bootstrap_unavailable"),
  );
}
