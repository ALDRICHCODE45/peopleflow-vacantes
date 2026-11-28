import { beforeEach, expect, it } from "vitest";
import {
  PENDING_EMAIL_KEY,
  PENDING_ORIGIN_KEY,
  PASSWORD_RESET_EMAIL_KEY,
  RECOVERY_EMAIL_KEY,
  VERIFIED_EMAIL_KEY,
  forgetPendingEmail,
  forgetRecoveryEmail,
  readRecoveryEmail,
  rememberPasswordResetEmail,
  rememberPendingEmail,
  rememberRecoveryEmail,
  rememberVerifiedEmail,
  takePendingEmail,
  takePendingVerification,
  takeSignInHandoff,
  takeVerifiedEmail,
} from "./pending-email";

beforeEach(() => window.sessionStorage.clear());

it("carries a trimmed email once, then forgets it", () => {
  rememberPendingEmail("  ximena@correo.com ", "sign-in");
  expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBe("ximena@correo.com");
  expect(takePendingEmail()).toBe("ximena@correo.com");
  expect(takePendingEmail()).toBeNull();
});

it("carries where the person came from, so only the sign-in handoff resends a code on arrival", () => {
  rememberPendingEmail("ximena@correo.com", "sign-in");
  expect(takePendingVerification()).toEqual({ email: "ximena@correo.com", origin: "sign-in" });
  expect(takePendingVerification()).toBeNull();
  rememberPendingEmail("ximena@correo.com", "sign-up");
  expect(takePendingVerification()).toEqual({ email: "ximena@correo.com", origin: "sign-up" });
});

it("treats an email without a known origin as neither handoff", () => {
  window.sessionStorage.setItem(PENDING_EMAIL_KEY, "ximena@correo.com");
  window.sessionStorage.setItem(PENDING_ORIGIN_KEY, "other");
  expect(takePendingVerification()).toEqual({ email: "ximena@correo.com", origin: null });
  rememberPendingEmail("ximena@correo.com", null);
  expect(window.sessionStorage.getItem(PENDING_ORIGIN_KEY)).toBeNull();
  expect(takePendingVerification()).toEqual({ email: "ximena@correo.com", origin: null });
});

it("forgets the email and its origin together", () => {
  rememberPendingEmail("ximena@correo.com", "sign-in");
  forgetPendingEmail();
  expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBeNull();
  expect(window.sessionStorage.getItem(PENDING_ORIGIN_KEY)).toBeNull();
});

it("carries a verified email to «Ingresar» once", () => {
  rememberVerifiedEmail(" ximena@correo.com ");
  expect(window.sessionStorage.getItem(VERIFIED_EMAIL_KEY)).toBe("ximena@correo.com");
  expect(takeVerifiedEmail()).toBe("ximena@correo.com");
  expect(takeVerifiedEmail()).toBeNull();
});

it("carries a reset email to «Ingresar» once, and that handoff wins over a stale verified one (both consumed)", () => {
  expect(takeSignInHandoff()).toBeNull();
  rememberVerifiedEmail("old@correo.com");
  rememberPasswordResetEmail(" ximena@correo.com ");
  expect(window.sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY)).toBe("ximena@correo.com");
  expect(takeSignInHandoff()).toEqual({ email: "ximena@correo.com", notice: "password_reset" });
  expect(takeSignInHandoff()).toBeNull();
  expect(window.sessionStorage.getItem(VERIFIED_EMAIL_KEY)).toBeNull();
  rememberVerifiedEmail("ximena@correo.com");
  expect(takeSignInHandoff()).toEqual({ email: "ximena@correo.com", notice: "verified" });
});

it("keeps the recovery email across a reload of «Recupera tu acceso» until it is forgotten", () => {
  expect(readRecoveryEmail()).toBeNull();
  rememberRecoveryEmail(" ximena@correo.com ");
  expect(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY)).toBe("ximena@correo.com");
  expect(readRecoveryEmail()).toBe("ximena@correo.com");
  expect(readRecoveryEmail()).toBe("ximena@correo.com");
  forgetRecoveryEmail();
  expect(readRecoveryEmail()).toBeNull();
});

it("never stores anything but a plausible email for recovery", () => {
  window.sessionStorage.setItem(RECOVERY_EMAIL_KEY, "not an email");
  expect(readRecoveryEmail()).toBeNull();
});

it("never hands an implausible stored email to «Ingresar» (verified or reset), and still consumes it", () => {
  window.sessionStorage.setItem(VERIFIED_EMAIL_KEY, "not an email");
  expect(takeVerifiedEmail()).toBeNull();
  expect(window.sessionStorage.getItem(VERIFIED_EMAIL_KEY)).toBeNull();

  window.sessionStorage.setItem(VERIFIED_EMAIL_KEY, "<script>@x");
  expect(takeSignInHandoff()).toBeNull();

  window.sessionStorage.setItem(PASSWORD_RESET_EMAIL_KEY, `${"a".repeat(260)}@correo.com`);
  expect(takeSignInHandoff()).toBeNull();
  expect(window.sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY)).toBeNull();

  // An implausible reset handoff counts as none; a plausible verified one still applies.
  window.sessionStorage.setItem(PASSWORD_RESET_EMAIL_KEY, "nope");
  rememberVerifiedEmail("ximena@correo.com");
  expect(takeSignInHandoff()).toEqual({ email: "ximena@correo.com", notice: "verified" });
});
