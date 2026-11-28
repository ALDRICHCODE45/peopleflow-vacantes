import "server-only";
import { createHash } from "node:crypto";
import type { CognitoClientOperation } from "./cognito/errors";

/**
 * Rate limiting for the embedded auth routes (A4.3, L16 R1): the password
 * callback today, and the sign-up / confirm / resend / forgot / confirm-forgot
 * routes of A4.4–A4.6 through the same `createAuthAttemptLimiter`.
 *
 * Every attempt is counted per client address AND per normalized email; over
 * either limit the route answers `too_many_attempts` without calling Cognito.
 *
 * Scope note (multi-instance): counters live in this process's memory. With N
 * instances an attacker gets up to N× the budget, and a restart resets it. That
 * is acceptable while one instance runs; the AWS phase must move the counters to
 * a shared store (e.g. DynamoDB/ElastiCache with TTL) or to WAF rate rules, and
 * pin which X-Forwarded-For hop is trusted (see `clientIpFrom`).
 *
 * Privacy: emails are keyed by a SHA-256 of their normalized form, never stored
 * raw; passwords are never read; nothing here logs.
 */

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export type FixedWindowLimiter = {
  /** Whether `key` still has budget, without counting. */
  check(key: string): RateLimitResult;
  /** Counts one attempt for `key` when it has budget; refuses (without counting) otherwise. */
  hit(key: string): RateLimitResult;
  size(): number;
};

export type FixedWindowOptions = {
  limit: number;
  windowMs: number;
  /** Bound on tracked keys; expired keys go first, then the oldest. */
  maxKeys?: number;
  now?: () => number;
};

const DEFAULT_MAX_KEYS = 10_000;

export function createFixedWindowLimiter({ limit, windowMs, maxKeys = DEFAULT_MAX_KEYS, now = Date.now }: FixedWindowOptions): FixedWindowLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function current(key: string, at: number) {
    const entry = windows.get(key);
    if (entry && entry.resetAt <= at) {
      windows.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * Frees one slot for a new key, so a new key is always admitted (a full table
   * must never turn into a sign-in outage for people not yet tracked): expired
   * windows first, then the oldest key still under its limit, and only when every
   * tracked key is over its limit, the one whose window ends soonest.
   */
  function makeRoom(at: number): void {
    if (windows.size < maxKeys) return;
    for (const [key, entry] of windows) if (entry.resetAt <= at) windows.delete(key);
    if (windows.size < maxKeys) return;
    for (const [key, entry] of windows) {
      if (entry.count < limit) {
        windows.delete(key);
        return;
      }
    }
    let soonest: string | undefined;
    let soonestReset = Infinity;
    for (const [key, entry] of windows) {
      if (entry.resetAt < soonestReset) {
        soonest = key;
        soonestReset = entry.resetAt;
      }
    }
    if (soonest !== undefined) windows.delete(soonest);
  }

  function check(key: string): RateLimitResult {
    const at = now();
    const entry = current(key, at);
    if (entry && entry.count >= limit) return { ok: false, retryAfterMs: entry.resetAt - at };
    return { ok: true };
  }

  return {
    check,
    hit(key) {
      const verdict = check(key);
      if (!verdict.ok) return verdict;
      const at = now();
      const entry = current(key, at);
      if (entry) entry.count += 1;
      else {
        makeRoom(at);
        windows.set(key, { count: 1, resetAt: at + windowMs });
      }
      return { ok: true };
    },
    size: () => windows.size,
  };
}

/** Same normalization as the Cognito client (trim + lowercase), then hashed. */
export function emailRateKey(email: string): string {
  return createHash("sha256").update(`peopleflow.auth.rate:${email.trim().toLowerCase()}`).digest("hex");
}

const IP_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The client address as the nearest proxy saw it: the right-most
 * X-Forwarded-For entry (appended by the proxy in front of Next), else
 * X-Real-IP, else `null` (no usable address: the caller skips the per-IP
 * limit rather than sharing one bucket among every such request; the per-email
 * limit still applies). Behind exactly one trusted proxy this cannot be
 * forged by the client. Exposed directly, the header is client-controlled and
 * the per-IP limit can be dodged (the per-email limit still holds); the AWS
 * phase must fix the trusted hop count for its load balancer.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const candidate = forwarded
    ? forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    : headers.get("x-real-ip")?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : null;
}

/** The operations an embedded-auth route performs; the same names the Cognito client uses (no refresh). */
export type AuthAttemptOperation = Exclude<CognitoClientOperation, "refresh">;

type Window = { limit: number; windowMs: number };
export type AuthRatePolicy = { perIp: Window; perEmail: Window };

const MINUTE = 60_000;

/**
 * Per-IP budgets are wider than per-email ones because offices share one
 * address (NAT). Code-sending operations are the tightest: each one emails a
 * person. Cognito keeps its own limits underneath (LimitExceededException).
 */
export const AUTH_RATE_LIMITS: Record<AuthAttemptOperation, AuthRatePolicy> = {
  signIn: { perIp: { limit: 50, windowMs: 15 * MINUTE }, perEmail: { limit: 10, windowMs: 15 * MINUTE } },
  signUp: { perIp: { limit: 10, windowMs: 60 * MINUTE }, perEmail: { limit: 5, windowMs: 60 * MINUTE } },
  confirmSignUp: { perIp: { limit: 30, windowMs: 15 * MINUTE }, perEmail: { limit: 10, windowMs: 15 * MINUTE } },
  resendCode: { perIp: { limit: 10, windowMs: 15 * MINUTE }, perEmail: { limit: 3, windowMs: 15 * MINUTE } },
  forgotPassword: { perIp: { limit: 10, windowMs: 15 * MINUTE }, perEmail: { limit: 3, windowMs: 15 * MINUTE } },
  confirmForgotPassword: { perIp: { limit: 30, windowMs: 15 * MINUTE }, perEmail: { limit: 10, windowMs: 15 * MINUTE } },
};

/** Either key may be absent: an unknown address, or (password callback) no valid CSRF pair for the email. */
export type AuthAttemptKeys = { ip?: string; email?: string };

export type AuthAttemptLimiter = {
  /** Counts the attempt on both keys only when both have budget. */
  attempt(operation: AuthAttemptOperation, keys: AuthAttemptKeys): RateLimitResult;
};

export function createAuthAttemptLimiter({
  policies = AUTH_RATE_LIMITS,
  now = Date.now,
  maxKeys,
}: { policies?: Record<AuthAttemptOperation, AuthRatePolicy>; now?: () => number; maxKeys?: number } = {}): AuthAttemptLimiter {
  const limiters = new Map<AuthAttemptOperation, { ip: FixedWindowLimiter; email: FixedWindowLimiter }>();

  function forOperation(operation: AuthAttemptOperation) {
    let pair = limiters.get(operation);
    if (!pair) {
      const policy = policies[operation];
      pair = {
        ip: createFixedWindowLimiter({ ...policy.perIp, now, maxKeys }),
        email: createFixedWindowLimiter({ ...policy.perEmail, now, maxKeys }),
      };
      limiters.set(operation, pair);
    }
    return pair;
  }

  return {
    attempt(operation, { ip, email }) {
      const pair = forOperation(operation);
      const emailKey = typeof email === "string" && email.trim() !== "" ? emailRateKey(email) : undefined;
      const ipKey = typeof ip === "string" && ip !== "" ? ip : undefined;
      const verdicts = [...(ipKey ? [pair.ip.check(ipKey)] : []), ...(emailKey ? [pair.email.check(emailKey)] : [])];
      const refused = verdicts.filter((verdict): verdict is { ok: false; retryAfterMs: number } => !verdict.ok);
      if (refused.length > 0) return { ok: false, retryAfterMs: Math.max(...refused.map((verdict) => verdict.retryAfterMs)) };
      // Both keys had budget, and a hit always admits a new key (makeRoom), so both are counted.
      if (ipKey) pair.ip.hit(ipKey);
      if (emailKey) pair.email.hit(emailKey);
      return { ok: true };
    },
  };
}
