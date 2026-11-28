/**
 * Embedded-auth routes per audience: sign-in (A4.3), sign-up and verify-code
 * (A4.4 / A4.5) and password recovery (A4.6).
 */
export type SignInAudience = "employer" | "candidate";

export type AuthPaths = { login: string; signUp: string; verify: string; forgot: string };

export const AUTH_PATHS: Record<SignInAudience, AuthPaths> = {
  employer: { login: "/empresa/login", signUp: "/empresa/registro", verify: "/empresa/verificar", forgot: "/empresa/recuperar" },
  candidate: { login: "/candidato/login", signUp: "/candidato/registro", verify: "/candidato/verificar", forgot: "/candidato/recuperar" },
};
