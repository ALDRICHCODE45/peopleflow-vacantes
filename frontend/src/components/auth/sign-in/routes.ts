/**
 * Embedded-auth routes per audience. Sign-in exists (A4.3); the others are the
 * planned paths of the sign-up, verify-code and recovery screens (A4.4–A4.6),
 * linked from here so those slices only add the pages.
 */
export type SignInAudience = "employer" | "candidate";

export type AuthPaths = { login: string; signUp: string; verify: string; forgot: string };

export const AUTH_PATHS: Record<SignInAudience, AuthPaths> = {
  employer: { login: "/empresa/login", signUp: "/empresa/registro", verify: "/empresa/verificar", forgot: "/empresa/recuperar" },
  candidate: { login: "/candidato/login", signUp: "/candidato/registro", verify: "/candidato/verificar", forgot: "/candidato/recuperar" },
};
