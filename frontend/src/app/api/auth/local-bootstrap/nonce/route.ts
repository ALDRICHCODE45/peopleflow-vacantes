import type { NextRequest } from "next/server";
import { validateLocalBootstrapEnv } from "@/lib/auth/local-bootstrap/config";
import { createCsrfToken, csrfCookie } from "@/lib/auth/local-bootstrap/csrf";
import {
  LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS,
  bootstrapJsonResponse,
  errorBody,
} from "@/lib/auth/local-bootstrap/respond";
import { resolveLocalBootstrapSession } from "@/lib/auth/local-bootstrap/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only CSRF initialization: it resolves the current private session and
 * issues a session-bound nonce. It performs no Go call, no database write and
 * no mutation; query parameters are ignored. It intentionally does not require
 * an Origin header because same-origin GET requests may omit it.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const state = validateLocalBootstrapEnv(process.env);
  if (state.status !== "enabled") return unavailable();

  let session;
  try {
    session = await resolveLocalBootstrapSession(request);
  } catch {
    return unavailable();
  }
  if (!session.accessToken) {
    return bootstrapJsonResponse(401, errorBody("unauthenticated"), session.cookies);
  }

  const nonce = createCsrfToken(state.config.csrfSecret, session.accessToken);
  return bootstrapJsonResponse(
    200,
    { ok: true, nonce },
    [...session.cookies, csrfCookie(nonce)],
  );
}

function unavailable(): Response {
  return bootstrapJsonResponse(
    LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS,
    errorBody("local_bootstrap_unavailable"),
  );
}
