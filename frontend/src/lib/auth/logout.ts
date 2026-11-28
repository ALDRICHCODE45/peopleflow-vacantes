import type { AuthEnv } from "./env";
import { EMPLOYER_LOGIN_PATH } from "./env";
import type { SessionKind } from "./refresh";

export const AUTH_COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
] as const;

export function buildEmployerLoginUrl(config: AuthEnv): string {
  return new URL(EMPLOYER_LOGIN_PATH, config.siteUrl).toString();
}

/**
 * Builds the Cognito managed-logout destination from validated configuration.
 * The return URL comes from the configured origin only, so a caller cannot
 * inject an arbitrary redirect target.
 */
export function buildCognitoLogoutUrl(config: AuthEnv, to?: string | null): string {
  const url = new URL("/logout", config.domain);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("logout_uri", buildAudienceLoginUrl(config, to));
  return url.toString();
}

/** An enum, never a request-supplied URL or path. Unknown values preserve employer logout. */
function buildAudienceLoginUrl(config: AuthEnv, to?: string | null): string {
  return to === "candidato" ? new URL("/candidato/login", config.siteUrl).toString() : config.employerLoginUrl;
}

/**
 * Where the logout route sends the browser. A password session has no Cognito
 * hosted-login session to end, so it returns straight to the audience login
 * page; OAuth/social sessions keep the Cognito /logout hop.
 */
export function buildLogoutDestination(config: AuthEnv, to: string | null | undefined, kind: SessionKind): string {
  return kind === "password" ? buildAudienceLoginUrl(config, to) : buildCognitoLogoutUrl(config, to);
}

/**
 * NextAuth clears the session cookie before the logout route runs, so the
 * route guard leaves this short-lived hint on sign-out (route-guard.ts). It is
 * not a secret and grants nothing: a forged value can only skip the Cognito
 * /logout hop for the forger's own browser, and a missing one falls back to
 * the hop (the safe direction).
 */
export const LOGOUT_KIND_COOKIE = "peopleflow.logout-kind";
const LOGOUT_ROUTE_PATH = "/api/auth/cognito/logout";
const LOGOUT_KIND_MAX_AGE_SECONDS = 120;

export function logoutKindCookie(kind: SessionKind, secure: boolean) {
  const password = kind === "password";
  return {
    name: LOGOUT_KIND_COOKIE,
    value: password ? "password" : "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: LOGOUT_ROUTE_PATH,
      maxAge: password ? LOGOUT_KIND_MAX_AGE_SECONDS : 0,
      secure,
    },
  };
}

export function serializeLogoutKindCookie(kind: SessionKind, secure: boolean): string {
  const { name, value, options } = logoutKindCookie(kind, secure);
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    ...(options.secure ? ["Secure"] : []),
    "HttpOnly",
    `SameSite=${options.sameSite}`,
  ].join("; ");
}

/** `password` only for the exact hint; anything else keeps the Cognito hop. */
export function readLogoutKind(cookieHeader: string | null): SessionKind {
  if (!cookieHeader) return "oauth";
  for (const pair of cookieHeader.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === LOGOUT_KIND_COOKIE && pair.slice(index + 1).trim() === "password") return "password";
  }
  return "oauth";
}

export function cookieClearOptions(name: string) {
  const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
  return secure ? { maxAge: 0, path: "/", secure: true } : { maxAge: 0, path: "/" };
}
