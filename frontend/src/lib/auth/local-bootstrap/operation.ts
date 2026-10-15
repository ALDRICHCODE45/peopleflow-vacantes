import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only transaction binding for the temporary local identity bootstrap.
 *
 * After a successful `POST /stage` the frontend mints one signed, HttpOnly
 * binding cookie that ties the current authenticated private access, the exact
 * CSRF nonce and the exact Go operation code together for at most 60 seconds.
 * `POST /apply` requires that binding and re-checks it against the CURRENT
 * session before any Go call, so an operation staged for one session, nonce or
 * code cannot be applied by another.
 *
 * This is not operator approval and not a write guarantee: Go stays
 * authoritative for the terminal grant, the single creation attempt and
 * concurrent anti-replay. The binding stores no access JWT, no profile and no
 * PII, and it is intentionally not consumed on the frontend, so an explicit
 * apply may be retried with the same operation after a `409 approval_required`
 * while the short TTL is still valid.
 */
export const OPERATION_COOKIE_NAME = "pf_local_bootstrap_operation";
export const OPERATION_COOKIE_PATH = "/api/auth/local-bootstrap";
export const OPERATION_MAX_TTL_SECONDS = 60;

const MAX_TOKEN_LENGTH = 256;
const FUTURE_TOLERANCE_MS = 5_000;

export type OperationBindingResult = "valid" | "expired" | "invalid";

function digest(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("base64url");
}

function signature(
  secret: string,
  accessToken: string,
  csrfNonce: string,
  operationCode: string,
  issuedAtSeconds: number,
  ttlSeconds: number,
): string {
  return createHmac("sha256", secret)
    .update(
      `v1:${digest(accessToken)}:${csrfNonce}:${operationCode}:${issuedAtSeconds}:${ttlSeconds}`,
    )
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function boundedTtl(ttlSeconds: number): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > OPERATION_MAX_TTL_SECONDS)
    return OPERATION_MAX_TTL_SECONDS;
  return ttlSeconds;
}

export function createOperationBinding(
  secret: string,
  accessToken: string,
  csrfNonce: string,
  operationCode: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const ttl = boundedTtl(ttlSeconds);
  const issuedAtSeconds = Math.floor(now / 1000);
  return `${issuedAtSeconds.toString(36)}.${ttl.toString(36)}.${signature(secret, accessToken, csrfNonce, operationCode, issuedAtSeconds, ttl)}`;
}

export function verifyOperationBinding(
  secret: string,
  accessToken: string,
  csrfNonce: string,
  operationCode: string,
  token: unknown,
  now: number = Date.now(),
): OperationBindingResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
    return "invalid";
  const parts = token.split(".");
  if (parts.length !== 3) return "invalid";
  const [issuedRaw, ttlRaw, providedSignature] = parts;
  if (!issuedRaw || !ttlRaw || !providedSignature) return "invalid";
  if (!/^[0-9a-z]+$/.test(issuedRaw) || !/^[0-9a-z]+$/.test(ttlRaw)) return "invalid";

  const issuedAtSeconds = Number.parseInt(issuedRaw, 36);
  const ttlSeconds = Number.parseInt(ttlRaw, 36);
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) return "invalid";
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > OPERATION_MAX_TTL_SECONDS)
    return "invalid";

  const expected = signature(
    secret,
    accessToken,
    csrfNonce,
    operationCode,
    issuedAtSeconds,
    ttlSeconds,
  );
  if (!safeEqual(expected, providedSignature)) return "invalid";

  const issuedAtMs = issuedAtSeconds * 1000;
  if (issuedAtMs > now + FUTURE_TOLERANCE_MS) return "invalid";
  if (now - issuedAtMs > ttlSeconds * 1000) return "expired";
  return "valid";
}

export function operationCookie(binding: string, ttlSeconds: number): string {
  const maxAge = boundedTtl(ttlSeconds);
  return `${OPERATION_COOKIE_NAME}=${binding}; HttpOnly; SameSite=Strict; Path=${OPERATION_COOKIE_PATH}; Max-Age=${maxAge}`;
}
