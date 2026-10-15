import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Dedicated anti-CSRF nonce for the local bootstrap bridge.
 *
 * The token is bound to the current private session through an HMAC over a
 * one-way digest of the server-held access token, so a token minted for one
 * authenticated session cannot authorize another (account switch). It is opaque,
 * short-lived, never contains the secret or the access token, and never becomes
 * an authentication credential.
 */
export const CSRF_COOKIE_NAME = "pf_local_bootstrap_csrf";
export const CSRF_HEADER_NAME = "x-local-bootstrap-csrf";
export const CSRF_COOKIE_PATH = "/api/auth/local-bootstrap";
export const CSRF_COOKIE_MAX_AGE_SECONDS = 300;

const CSRF_MAX_TOKEN_LENGTH = 256;
const CSRF_FUTURE_TOLERANCE_MS = 5_000;

function sessionDigest(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("base64url");
}

function signature(
  secret: string,
  accessToken: string,
  nonce: string,
  issuedAtSeconds: number,
): string {
  return createHmac("sha256", secret)
    .update(`v1:${sessionDigest(accessToken)}:${nonce}:${issuedAtSeconds}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function createCsrfToken(
  secret: string,
  accessToken: string,
  now: number = Date.now(),
): string {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAtSeconds = Math.floor(now / 1000);
  return `${nonce}.${issuedAtSeconds.toString(36)}.${signature(secret, accessToken, nonce, issuedAtSeconds)}`;
}

export function verifyCsrfToken(
  secret: string,
  accessToken: string,
  token: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > CSRF_MAX_TOKEN_LENGTH)
    return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issuedRaw, providedSignature] = parts;
  if (!nonce || !issuedRaw || !providedSignature) return false;
  if (!/^[0-9a-z]+$/.test(issuedRaw)) return false;

  const issuedAtSeconds = Number.parseInt(issuedRaw, 36);
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) return false;
  const issuedAtMs = issuedAtSeconds * 1000;
  if (issuedAtMs > now + CSRF_FUTURE_TOLERANCE_MS) return false;
  if (now - issuedAtMs > CSRF_COOKIE_MAX_AGE_SECONDS * 1000) return false;

  return safeEqual(signature(secret, accessToken, nonce, issuedAtSeconds), providedSignature);
}

/** Double-submit check: the browser-held cookie must match the request header exactly. */
export function isCsrfValid(
  cookieValue: string | undefined,
  headerValue: string | null,
): boolean {
  if (typeof cookieValue !== "string" || typeof headerValue !== "string") return false;
  if (cookieValue.length === 0 || cookieValue.length > CSRF_MAX_TOKEN_LENGTH) return false;
  if (headerValue.length !== cookieValue.length) return false;
  return safeEqual(cookieValue, headerValue);
}

export function csrfCookie(nonce: string): string {
  return `${CSRF_COOKIE_NAME}=${nonce}; HttpOnly; SameSite=Strict; Path=${CSRF_COOKIE_PATH}; Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}`;
}
