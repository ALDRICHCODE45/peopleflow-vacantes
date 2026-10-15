import type { LocalBootstrapErrorCode } from "./contract";

/**
 * `local_bootstrap_unavailable` is the only frontend-originated code: it means
 * this local tool is disabled or misconfigured, so no Go request was made. It
 * never overlaps a Go code and carries no detail.
 */
export type LocalBootstrapFrontendCode = "local_bootstrap_unavailable";
export type LocalBootstrapResponseCode = LocalBootstrapErrorCode | LocalBootstrapFrontendCode;

export const LOCAL_BOOTSTRAP_UNAVAILABLE_STATUS = 503;

export function errorBody(code: LocalBootstrapResponseCode): {
  ok: false;
  code: LocalBootstrapResponseCode;
} {
  return { ok: false, code };
}

/**
 * Builds a sanitized response: always `no-store`, `vary: Cookie`, and, when the
 * private session produced effective renewal cookies, those cookies are
 * forwarded so a renewed session persists. No other header is copied.
 */
export function bootstrapJsonResponse(
  status: number,
  body: unknown,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({ "cache-control": "no-store", vary: "Cookie" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}
