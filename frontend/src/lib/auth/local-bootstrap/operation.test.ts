import { describe, expect, it } from "vitest";
import {
  OPERATION_COOKIE_NAME,
  OPERATION_MAX_TTL_SECONDS,
  createOperationBinding,
  operationCookie,
  verifyOperationBinding,
} from "./operation";
import { FIXTURE_ACCESS, FIXTURE_NEXTAUTH_SECRET, FIXTURE_OPERATION_CODE } from "./fixtures";

const NOW = 1_700_000_000_000;
const CSRF = "fixture-csrf-nonce-value";
const OTHER_CODE = "MFRGGZDFMZTWQ2LKNNWG23TPA";

describe("transaction binding", () => {
  it("validates only the exact current access, csrf nonce, operation code and secret", () => {
    const token = createOperationBinding(
      FIXTURE_NEXTAUTH_SECRET,
      FIXTURE_ACCESS,
      CSRF,
      FIXTURE_OPERATION_CODE,
      60,
      NOW,
    );
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toContain(FIXTURE_ACCESS);
    expect(token).not.toContain(CSRF);
    expect(token).not.toContain(FIXTURE_OPERATION_CODE);
    expect(
      verifyOperationBinding(
        FIXTURE_NEXTAUTH_SECRET,
        FIXTURE_ACCESS,
        CSRF,
        FIXTURE_OPERATION_CODE,
        token,
        NOW,
      ),
    ).toBe("valid");
  });

  it.each([
    ["another access (account switch)", FIXTURE_NEXTAUTH_SECRET, "fixture-other-access", CSRF, FIXTURE_OPERATION_CODE],
    ["another csrf nonce", FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, "other-nonce", FIXTURE_OPERATION_CODE],
    ["another operation", FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, OTHER_CODE],
    ["another secret", "other-secret", FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE],
  ] as const)("returns invalid for %s", (_label, secret, access, csrf, code) => {
    const token = createOperationBinding(
      FIXTURE_NEXTAUTH_SECRET,
      FIXTURE_ACCESS,
      CSRF,
      FIXTURE_OPERATION_CODE,
      60,
      NOW,
    );
    expect(verifyOperationBinding(secret, access, csrf, code, token, NOW)).toBe("invalid");
  });

  it("distinguishes expired from invalid and rejects tampering, future issuance and malformed tokens", () => {
    const token = createOperationBinding(
      FIXTURE_NEXTAUTH_SECRET,
      FIXTURE_ACCESS,
      CSRF,
      FIXTURE_OPERATION_CODE,
      60,
      NOW,
    );
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, token, NOW + 60_000),
    ).toBe("valid");
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, token, NOW + 60_001),
    ).toBe("expired");
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, `${token}x`, NOW),
    ).toBe("invalid");
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, token, NOW - 6_000),
    ).toBe("invalid");
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, "", NOW),
    ).toBe("invalid");
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, "a.b", NOW),
    ).toBe("invalid");
    expect(OPERATION_MAX_TTL_SECONDS).toBe(60);
  });

  it("caps an over-long requested ttl at 60 seconds", () => {
    const token = createOperationBinding(
      FIXTURE_NEXTAUTH_SECRET,
      FIXTURE_ACCESS,
      CSRF,
      FIXTURE_OPERATION_CODE,
      3600,
      NOW,
    );
    expect(
      verifyOperationBinding(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, CSRF, FIXTURE_OPERATION_CODE, token, NOW + 60_001),
    ).toBe("expired");
    expect(operationCookie(token, 3600)).toContain("Max-Age=60");
  });

  it("scopes the cookie to the bridge path with HttpOnly and SameSite=Strict", () => {
    const cookie = operationCookie("fixture-binding", 60);
    expect(cookie).toContain(`${OPERATION_COOKIE_NAME}=fixture-binding`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=60");
    expect(cookie).not.toContain("Secure");
  });
});
