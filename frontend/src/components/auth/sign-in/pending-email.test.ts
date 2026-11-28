import { beforeEach, expect, it } from "vitest";
import {
  PENDING_EMAIL_KEY,
  PENDING_ORIGIN_KEY,
  VERIFIED_EMAIL_KEY,
  forgetPendingEmail,
  rememberPendingEmail,
  rememberVerifiedEmail,
  takePendingEmail,
  takePendingVerification,
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
