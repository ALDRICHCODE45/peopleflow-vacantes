import { NextResponse } from "next/server";
import { validateAuthEnv } from "@/lib/auth/env";
import {
  AUTH_COOKIE_NAMES,
  LOGOUT_KIND_COOKIE,
  buildLogoutDestination,
  cookieClearOptions,
  readLogoutKind,
} from "@/lib/auth/logout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Logout handoff. The UI calls `signOutWithAudit("/api/auth/cognito/logout")`,
 * which records the session end and then has NextAuth clear the local session
 * before this handler runs. This endpoint clears the cookies again defensively,
 * then sends OAuth/social sessions through Cognito managed logout and password
 * sessions (hinted by the route guard at sign-out) straight to the audience
 * login page. The destination comes from validated configuration only, so
 * request input cannot turn this into an open redirect.
 */
export function GET(request: Request) {
  let destination: string;
  try {
    const values = new URL(request.url).searchParams.getAll("to");
    const kind = readLogoutKind(request.headers.get("cookie"));
    destination = buildLogoutDestination(validateAuthEnv(process.env), values.length === 1 ? values[0] : undefined, kind);
  } catch {
    return new NextResponse("Authentication is not configured.", { status: 500 });
  }

  const response = NextResponse.redirect(destination);
  for (const name of AUTH_COOKIE_NAMES) {
    response.cookies.set(name, "", cookieClearOptions(name));
  }
  response.cookies.set(LOGOUT_KIND_COOKIE, "", { maxAge: 0, path: "/api/auth/cognito/logout", httpOnly: true, sameSite: "lax" });
  return response;
}
