import { NextResponse } from "next/server";
import { validateAuthEnv } from "@/lib/auth/env";
import { AUTH_COOKIE_NAMES, buildCognitoLogoutUrl, cookieClearOptions } from "@/lib/auth/logout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Federated logout for the employer Cognito session. The UI calls
 * `signOut({ callbackUrl: "/api/auth/cognito/logout" })`, which clears the
 * local NextAuth session before this handler runs. This endpoint clears the
 * cookies again defensively and then hands off to Cognito managed logout.
 * The destination comes from validated configuration only, so request input
 * cannot turn this into an open redirect.
 */
export function GET() {
  let destination: string;
  try {
    destination = buildCognitoLogoutUrl(validateAuthEnv(process.env));
  } catch {
    return new NextResponse("Authentication is not configured.", { status: 500 });
  }

  const response = NextResponse.redirect(destination);
  for (const name of AUTH_COOKIE_NAMES) {
    response.cookies.set(name, "", cookieClearOptions(name));
  }
  return response;
}
