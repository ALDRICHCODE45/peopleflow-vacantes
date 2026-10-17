import type { AuthEnv } from "./env";
import { EMPLOYER_LOGIN_PATH } from "./env";

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
  // An enum, never a request-supplied URL or path. Unknown values preserve employer logout.
  url.searchParams.set("logout_uri", to === "candidato"
    ? new URL("/candidato/login", config.siteUrl).toString()
    : config.employerLoginUrl);
  return url.toString();
}

export function cookieClearOptions(name: string) {
  const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
  return secure ? { maxAge: 0, path: "/", secure: true } : { maxAge: 0, path: "/" };
}
