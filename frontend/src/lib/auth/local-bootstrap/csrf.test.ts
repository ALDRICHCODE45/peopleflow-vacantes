import { describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_MAX_AGE_SECONDS,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_PATH,
  CSRF_HEADER_NAME,
  createCsrfToken,
  csrfCookie,
  isCsrfValid,
  verifyCsrfToken,
} from "./csrf";
import { FIXTURE_ACCESS, FIXTURE_NEXTAUTH_SECRET } from "./fixtures";

const NOW = 1_700_000_000_000;

describe("dedicated CSRF token", () => {
  it("mints an opaque token that never embeds the secret or the access token", () => {
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain(FIXTURE_NEXTAUTH_SECRET);
    expect(token).not.toContain(FIXTURE_ACCESS);
    expect(createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW)).not.toBe(token);
  });

  it("verifies only the exact session binding inside the freshness window", () => {
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, token, NOW)).toBe(true);
    expect(
      verifyCsrfToken(
        FIXTURE_NEXTAUTH_SECRET,
        FIXTURE_ACCESS,
        token,
        NOW + CSRF_COOKIE_MAX_AGE_SECONDS * 1000,
      ),
    ).toBe(true);
  });

  it("rejects a token minted for another authenticated session (account switch)", () => {
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, "fixture-other-access", token, NOW)).toBe(
      false,
    );
  });

  it("rejects tampering, expiry, future issuance and malformed tokens", () => {
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, `${token}x`, NOW)).toBe(false);
    expect(verifyCsrfToken("other-secret", FIXTURE_ACCESS, token, NOW)).toBe(false);
    expect(
      verifyCsrfToken(
        FIXTURE_NEXTAUTH_SECRET,
        FIXTURE_ACCESS,
        token,
        NOW + CSRF_COOKIE_MAX_AGE_SECONDS * 1000 + 1,
      ),
    ).toBe(false);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, token, NOW - 6_000)).toBe(
      false,
    );
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, "a.b", NOW)).toBe(false);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, "", NOW)).toBe(false);
  });

  it("requires an identical, non-empty cookie/header pair within the size bound", () => {
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    expect(isCsrfValid(token, token)).toBe(true);
    expect(isCsrfValid(token, `${token}x`)).toBe(false);
    expect(isCsrfValid(undefined, token)).toBe(false);
    expect(isCsrfValid(token, null)).toBe(false);
    expect(isCsrfValid("", "")).toBe(false);
    expect(isCsrfValid("a".repeat(300), "a".repeat(300))).toBe(false);
  });

  it("scopes the cookie to the bridge path with HttpOnly and SameSite=Strict", () => {
    const cookie = csrfCookie("fixture-nonce");
    expect(CSRF_COOKIE_NAME).toBe("pf_local_bootstrap_csrf");
    expect(CSRF_HEADER_NAME).toBe("x-local-bootstrap-csrf");
    expect(cookie).toContain(`${CSRF_COOKIE_NAME}=fixture-nonce`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Path=${CSRF_COOKIE_PATH}`);
    expect(cookie).toContain(`Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).not.toContain("Secure");
  });
});
