/**
 * Shape checks for Cognito JWTs received directly from Cognito by this server.
 *
 * The signature is NOT verified here: these helpers only refuse malformed
 * tokens and read claims that are used as identifiers (the refresh
 * SECRET_HASH username, NextAuth's opaque subject) or as display hints. No
 * authorization decision may rest on them; the backend verifies every access
 * token (RS256 via JWKS) on each request.
 */

/** Cognito subjects are UUIDs; the bound alphabet keeps odd values out of SECRET_HASH and cookies. */
const COGNITO_SUBJECT = /^[A-Za-z0-9-]{1,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16 * 1024;

export function isCognitoSubject(value: unknown): value is string {
  return typeof value === "string" && COGNITO_SUBJECT.test(value);
}

function decodeSegment(segment: string): Record<string, unknown> | undefined {
  if (!BASE64URL.test(segment)) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Header + payload of a well-formed, signed (alg ≠ none) compact JWT; `undefined` otherwise. */
export function readJwtClaims(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !BASE64URL.test(parts[2])) return undefined;
  const header = decodeSegment(parts[0]);
  if (!header || typeof header.alg !== "string" || header.alg.length === 0 || header.alg.toLowerCase() === "none") return undefined;
  return decodeSegment(parts[1]);
}

/** The `sub` of a well-formed Cognito access token (`token_use: "access"`), or `undefined`. */
export function accessTokenSubject(accessToken: unknown): string | undefined {
  const claims = readJwtClaims(accessToken);
  if (!claims || claims.token_use !== "access") return undefined;
  return isCognitoSubject(claims.sub) ? claims.sub : undefined;
}

/** Display-only `name` from a well-formed ID token; never used for authorization. */
export function idTokenDisplayName(idToken: unknown): string | null {
  const claims = readJwtClaims(idToken);
  const name = claims?.token_use === "id" ? claims.name : undefined;
  return typeof name === "string" && name.trim().length > 0 && name.length <= 200 ? name.trim() : null;
}
