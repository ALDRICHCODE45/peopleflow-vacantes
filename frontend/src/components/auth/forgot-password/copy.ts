import type { AlertTone } from "../sign-in/copy";

/** Artboard 01 · «¿Olvidaste tu contraseña?» (design/embedded-auth/_src/ui.js `forgot`, FLOWS.fp). */
export const RECOVER_EYEBROW = "Recuperar acceso";

export const REQUEST_COPY = {
  heading: "Restablece tu contraseña",
  subheading: "Escribe el correo de tu cuenta y te enviaremos un código.",
  emailLabel: "Correo",
  submit: "Enviar código",
  // Invented (A4.6): the artboard has no pending state for this button.
  pending: "Enviando código…",
} as const;

export const RESET_COPY = {
  heading: "Crea una contraseña nueva",
  /** Followed by the email in bold and «Usar otro correo». */
  forLead: "Para",
  useOtherEmail: "Usar otro correo",
  codeHint: "Revisa también tu carpeta de spam.",
  passwordLabel: "Nueva contraseña",
  submit: "Cambiar contraseña",
  // Invented (A4.6): the artboard has no pending state for this button.
  pending: "Cambiando contraseña…",
} as const;

export const BACK_TO_SIGN_IN = "Volver a ingresar";

/**
 * Invented (A4.7, L29): shown under «El código no es correcto o ya venció.» only
 * after an earlier confirm failed as «No pudimos conectarnos.», whose answer may
 * have been lost after Cognito already changed the password.
 */
export const LOST_RESPONSE_ADVISORY = {
  text: "Si ya cambiaste tu contraseña, ingresa con la nueva.",
  link: "Ingresar",
} as const;

export const RECOVER_ERRORS = {
  email: "Escribe un correo válido, como nombre@correo.com.",
  // Invented in A4.4 (VerifyForm): the artboard has no incomplete-code state.
  incomplete: "Escribe los 6 dígitos del código.",
  password: "Tu contraseña aún no cumple todos los requisitos.",
} as const;

export type RecoverAlertKind = "sent" | "resent" | "code_rejected" | "too_many_attempts" | "network";

export const RECOVER_ALERTS: Record<RecoverAlertKind, { tone: AlertTone; title: string; body?: string }> = {
  // Existence hiding: the same answer whether or not the email has an account.
  sent: { tone: "info", title: "Si hay una cuenta con ese correo, te enviamos un código.", body: "Vence en 1 hora." },
  // Invented (A4.6): the artboard has no resent state here; it keeps the existence hiding of «sent».
  resent: { tone: "info", title: "Si hay una cuenta con ese correo, te enviamos un código nuevo.", body: "El anterior ya no sirve." },
  // One message for a wrong or expired code (artboard «fp-bad»).
  code_rejected: { tone: "danger", title: "El código no es correcto o ya venció.", body: "Pide uno nuevo con «Reenviar código»." },
  // Body as A4.4's verify screen (no «restablece tu contraseña» exit: the person is already here).
  too_many_attempts: { tone: "review", title: "Demasiados intentos.", body: "Espera unos minutos antes de volver a intentarlo." },
  network: { tone: "danger", title: "No pudimos conectarnos.", body: "Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí." },
};
