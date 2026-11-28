import type { PasswordRequirement } from "@/lib/auth/password-policy";
import type { SignInAudience } from "../sign-in/routes";
import type { AlertTone } from "../sign-in/copy";

/** Artboard 01 · Crear cuenta (design/embedded-auth/_src/ui.js `signup`, REQS). */
export const SIGN_UP_FIELD_COPY: Record<SignInAudience, { emailLabel: string; emailPlaceholder: string; emailHint?: string; submit: string; pending: string }> = {
  employer: { emailLabel: "Correo corporativo", emailPlaceholder: "tu@empresa.com", emailHint: "De preferencia el de tu empresa; te ayudará cuando la verifiquemos.", submit: "Continuar", pending: "Creando cuenta…" },
  candidate: { emailLabel: "Correo", emailPlaceholder: "tu@correo.com", submit: "Crear perfil", pending: "Creando perfil…" },
};

/** Display order of the artboard (length, upper, lower, number, symbol). */
export const REQUIREMENT_LABELS: readonly (readonly [PasswordRequirement, string])[] = [
  ["min_length_8", "8 caracteres o más"],
  ["uppercase", "Una mayúscula"],
  ["lowercase", "Una minúscula"],
  ["number", "Un número"],
  ["symbol", "Un símbolo (#, $, !…)"],
];

export const REQUIREMENTS_LABEL = "Tu contraseña necesita:";
export const REQUIREMENTS_MET = "Tu contraseña cumple todos los requisitos.";

export const FIELD_ERRORS = {
  nameMissing: "Escribe tu nombre.",
  // Existing product copy (features/identity/onboarding.tsx): same 2–120 rule.
  nameLength: "Escribe un nombre de 2 a 120 caracteres.",
  email: "Escribe un correo válido, como nombre@correo.com.",
  password: "Tu contraseña aún no cumple todos los requisitos.",
  terms: "Acepta los Términos y el Aviso de privacidad para continuar.",
} as const;

export const TERMS_LABEL = "Acepto los Términos y el Aviso de privacidad.";

/** Artboard «Léelos aquí: Términos · Aviso de privacidad»; provisional pages until launch (L23). */
export const LEGAL_COPY = {
  lead: "Léelos aquí:",
  terms: "Términos",
  termsHref: "/terminos",
  privacy: "Aviso de privacidad",
  privacyHref: "/aviso-de-privacidad",
} as const;

export type SignUpAlertKind = "email_taken" | "too_many_attempts" | "network";

export const SIGN_UP_ALERTS: Record<SignUpAlertKind, { tone: AlertTone; title: string; body?: string }> = {
  // Invented (A4.4): the artboard hid an existing email (open question 1); Cognito answers it on SignUp,
  // so the copy says no more than «this email cannot create an account; sign in or reset» (errors.ts).
  email_taken: { tone: "danger", title: "Ese correo no se puede usar para crear un perfil.", body: "Si ya tienes perfil con ese correo, ingresa o restablece tu contraseña." },
  too_many_attempts: { tone: "review", title: "Demasiados intentos.", body: "Espera unos minutos antes de volver a intentarlo." },
  network: { tone: "danger", title: "No pudimos conectarnos.", body: "Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí." },
};
