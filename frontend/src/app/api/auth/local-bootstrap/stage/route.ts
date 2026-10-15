import type { NextRequest } from "next/server";
import {
  LOCAL_BOOTSTRAP_STAGE_BODY_MAX_BYTES,
  parseStageRequest,
  readBoundedRequestBody,
} from "@/lib/auth/local-bootstrap/body";
import { stageLocalIdentity } from "@/lib/auth/local-bootstrap/client";
import { isTrustedOrigin, validateLocalBootstrapEnv } from "@/lib/auth/local-bootstrap/config";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, isCsrfValid, verifyCsrfToken } from "@/lib/auth/local-bootstrap/csrf";
import {
  LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS,
  bootstrapJsonResponse,
  errorBody,
} from "@/lib/auth/local-bootstrap/respond";
import { createOperationBinding, operationCookie } from "@/lib/auth/local-bootstrap/operation";
import { resolveLocalBootstrapSession } from "@/lib/auth/local-bootstrap/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit stage action. Order is deliberately fail-closed: configuration,
 * literal trusted Origin, current private session, session-bound CSRF, an exact
 * `{}` browser body, and only then a single `POST /stage` with a fixed empty
 * body. The browser body is never trusted and Host/X-Forwarded-Host are never
 * consulted. A successful stage mints the short-lived, session/nonce/operation
 * bound transaction cookie that a later explicit apply must present.
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

  const raw = await readBoundedRequestBody(request, LOCAL_BOOTSTRAP_STAGE_BODY_MAX_BYTES);
  if (raw === null || parseStageRequest(raw) === null) {
    return bootstrapJsonResponse(400, errorBody("invalid_request"), session.cookies);
  }

  const outcome = await stageLocalIdentity(config, session.accessToken);
  if (outcome.kind === "success") {
    const binding = createOperationBinding(
      config.csrfSecret,
      session.accessToken,
      csrf,
      outcome.data.operation_code,
      outcome.data.expires_in,
    );
    return bootstrapJsonResponse(
      202,
      {
        ok: true,
        operation_code: outcome.data.operation_code,
        expires_in: outcome.data.expires_in,
      },
      [...session.cookies, operationCookie(binding, outcome.data.expires_in)],
    );
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
