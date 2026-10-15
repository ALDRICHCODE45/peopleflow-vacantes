import "server-only";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import type { PrivateBackendSession } from "../backend-check";
import { resolveBackendSession } from "../backend-session";

/**
 * Resolves the CURRENT private NextAuth session through the existing
 * renewed-and-cookie-persisted seam. Every stage/apply call runs this again, so
 * the bridge always forwards the current server-held access token with the
 * effective renewal cookies; nothing is cached between actions. The public
 * session and `/api/auth/session` are untouched.
 */
export async function resolveLocalBootstrapSession(
  request: NextRequest,
): Promise<PrivateBackendSession> {
  const { authOptions } = await import("../options");
  const url = request.nextUrl.clone();
  url.pathname = "/api/auth/session";
  url.search = "";
  const sessionRequest = new NextRequest(url, { headers: request.headers });
  return resolveBackendSession(authOptions, (options) =>
    NextAuth(options)(sessionRequest, {
      params: Promise.resolve({ nextauth: ["session"] }),
    }),
  );
}
