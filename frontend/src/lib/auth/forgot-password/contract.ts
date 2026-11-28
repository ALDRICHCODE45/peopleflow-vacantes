/**
 * Closed results of the «¿Olvidaste tu contraseña?» server actions (A4.6).
 * Client-safe: the screens validate with the shared sign-up rules
 * (`validEmail`, `validCode`, `meetsPasswordPolicy`) before calling the
 * actions, and the actions validate again (never trust the client).
 *
 * `forgotPasswordAction` answers `ok` for an existing, unknown, unconfirmed or
 * unverified account alike (existence hiding): the screen always says «Si hay
 * una cuenta con ese correo, te enviamos un código.».
 */

export type ForgotPasswordActionResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input" | "too_many_attempts" | "unavailable" };

export type ConfirmForgotPasswordField = "email" | "code" | "password";

export type ConfirmForgotPasswordActionResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; fields: ConfirmForgotPasswordField[] }
  | { ok: false; reason: "code_mismatch" | "code_expired" | "invalid_password" | "too_many_attempts" | "unavailable" };
