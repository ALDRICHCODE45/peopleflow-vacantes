// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMITS,
  clientIpFrom,
  createAuthAttemptLimiter,
  createFixedWindowLimiter,
  emailRateKey,
} from "./rate-limit";

describe("fixed-window limiter", () => {
  it("admits up to the limit per key inside the window, then refuses with the time left", () => {
    let now = 1_000;
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000, now: () => now });
    expect(limiter.hit("a")).toEqual({ ok: true });
    expect(limiter.hit("a")).toEqual({ ok: true });
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterMs: 60_000 });
    expect(limiter.hit("b")).toEqual({ ok: true });
    now += 30_000;
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterMs: 30_000 });
    now += 30_000;
    expect(limiter.hit("a")).toEqual({ ok: true });
  });

  it("checks without counting", () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => 0 });
    expect(limiter.check("a")).toEqual({ ok: true });
    expect(limiter.check("a")).toEqual({ ok: true });
    limiter.hit("a");
    expect(limiter.check("a")).toEqual({ ok: false, retryAfterMs: 1_000 });
  });

  it("keeps memory bounded: expired keys are pruned first, then the oldest under-limit key is evicted", () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2, now: () => now });
    limiter.hit("a");
    limiter.hit("b");
    expect(limiter.size()).toBe(2);
    limiter.hit("c");
    expect(limiter.size()).toBe(2);
    // "a" (oldest, under its limit) was evicted: it starts a fresh window.
    limiter.hit("a");
    expect(limiter.hit("a").ok).toBe(true);
    now = 5_000;
    limiter.hit("d");
    expect(limiter.size()).toBe(1);
  });

  it("always admits a new key when every tracked key is over its limit, evicting the one that resets soonest", () => {
    let now = 0;
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => now });
    limiter.hit("early"); // over its limit, resets at 1000
    now = 50;
    limiter.hit("late"); // over its limit, resets at 1050
    now = 100;
    // A full table of over-limit keys must not lock out someone not yet tracked.
    expect(limiter.hit("newcomer")).toEqual({ ok: true });
    expect(limiter.size()).toBe(2);
    // The key closest to expiry was the one evicted; the other keeps its lockout.
    expect(limiter.hit("late")).toEqual({ ok: false, retryAfterMs: 950 });
    expect(limiter.hit("early")).toEqual({ ok: true });
  });

  it("evicts an under-limit key rather than an older over-limit one", () => {
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2, now: () => 0 });
    limiter.hit("blocked");
    limiter.hit("blocked"); // over (at) limit, oldest
    limiter.hit("free"); // under limit
    expect(limiter.hit("newcomer").ok).toBe(true);
    expect(limiter.hit("blocked").ok).toBe(false);
  });
});

describe("rate-limit keys", () => {
  it("keys an email by its normalized form and never by the raw value", () => {
    const key = emailRateKey("  Laura@Empresa.MX ");
    expect(key).toBe(emailRateKey("laura@empresa.mx"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("laura");
  });

  it.each([
    [{ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }, "10.0.0.2"],
    [{ "x-forwarded-for": "198.51.100.7" }, "198.51.100.7"],
    [{ "x-forwarded-for": "2001:db8::1" }, "2001:db8::1"],
    [{ "x-real-ip": "198.51.100.8" }, "198.51.100.8"],
    [{}, null],
    [{ "x-forwarded-for": "not an ip<script>" }, null],
    [{ "x-forwarded-for": " , " }, null],
  ])("takes the client address the nearest proxy saw: %j", (headers, ip) => {
    expect(clientIpFrom(new Headers(headers))).toBe(ip);
  });
});

describe("auth attempt limiter (password callback and the A4.4–A4.6 routes)", () => {
  it("has a policy for sign-in and every code/sign-up/forgot operation", () => {
    expect(Object.keys(AUTH_RATE_LIMITS).sort()).toEqual(
      ["confirmForgotPassword", "confirmSignUp", "forgotPassword", "resendCode", "signIn", "signUp"].sort(),
    );
    for (const policy of Object.values(AUTH_RATE_LIMITS)) {
      expect(policy.perEmail.limit).toBeLessThanOrEqual(policy.perIp.limit);
    }
  });

  it("refuses once the per-email limit is reached, whatever the address", () => {
    const limiter = createAuthAttemptLimiter({ now: () => 0 });
    const { limit } = AUTH_RATE_LIMITS.signIn.perEmail;
    for (let i = 0; i < limit; i++) expect(limiter.attempt("signIn", { ip: `198.51.100.${i}`, email: "Laura@empresa.mx" }).ok).toBe(true);
    expect(limiter.attempt("signIn", { ip: "203.0.113.1", email: " laura@EMPRESA.mx" })).toEqual({ ok: false, retryAfterMs: AUTH_RATE_LIMITS.signIn.perEmail.windowMs });
    // Another email from a fresh address is still admitted.
    expect(limiter.attempt("signIn", { ip: "203.0.113.1", email: "otra@empresa.mx" }).ok).toBe(true);
  });

  it("refuses once the per-IP limit is reached, whatever the email", () => {
    const limiter = createAuthAttemptLimiter({ now: () => 0 });
    const { limit } = AUTH_RATE_LIMITS.signIn.perIp;
    for (let i = 0; i < limit; i++) expect(limiter.attempt("signIn", { ip: "198.51.100.1", email: `u${i}@x.mx` }).ok).toBe(true);
    expect(limiter.attempt("signIn", { ip: "198.51.100.1", email: "new@x.mx" }).ok).toBe(false);
    expect(limiter.attempt("signIn", { ip: "198.51.100.1" }).ok).toBe(false);
  });

  it("does not count a refused attempt against the other key", () => {
    const limiter = createAuthAttemptLimiter({ now: () => 0 });
    const { limit } = AUTH_RATE_LIMITS.signIn.perEmail;
    for (let i = 0; i < limit; i++) limiter.attempt("signIn", { ip: `198.51.100.${i}`, email: "a@x.mx" });
    for (let i = 0; i < 50; i++) limiter.attempt("signIn", { ip: "203.0.113.5", email: "a@x.mx" });
    // The blocked email did not burn 203.0.113.5's own budget.
    expect(limiter.attempt("signIn", { ip: "203.0.113.5", email: "b@x.mx" }).ok).toBe(true);
  });

  it("skips the per-IP budget when the address is unknown (no shared bucket), keeping the per-email one", () => {
    const limiter = createAuthAttemptLimiter({ now: () => 0 });
    const { limit: ipLimit } = AUTH_RATE_LIMITS.signIn.perIp;
    for (let i = 0; i < ipLimit + 5; i++) expect(limiter.attempt("signIn", { email: `u${i}@x.mx` }).ok).toBe(true);
    const { limit: emailLimit } = AUTH_RATE_LIMITS.signIn.perEmail;
    for (let i = 0; i < emailLimit; i++) limiter.attempt("signIn", { email: "same@x.mx" });
    expect(limiter.attempt("signIn", { email: "same@x.mx" }).ok).toBe(false);
    expect(limiter.attempt("signIn", {}).ok).toBe(true);
  });

  it("keeps each operation's budget separate", () => {
    const limiter = createAuthAttemptLimiter({ now: () => 0 });
    const { limit } = AUTH_RATE_LIMITS.forgotPassword.perEmail;
    for (let i = 0; i < limit; i++) limiter.attempt("forgotPassword", { ip: "198.51.100.1", email: "a@x.mx" });
    expect(limiter.attempt("forgotPassword", { ip: "198.51.100.1", email: "a@x.mx" }).ok).toBe(false);
    expect(limiter.attempt("signIn", { ip: "198.51.100.1", email: "a@x.mx" }).ok).toBe(true);
  });
});
