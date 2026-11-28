import CredentialsProvider from "next-auth/providers/credentials";
import type { CognitoClient, CognitoFailureReason } from "./cognito/client";
import type { CognitoClientOperation } from "./cognito/errors";
import { accessTokenSubject, idTokenDisplayName } from "./token-shape";

/** NextAuth provider id: the screens call `signIn("password", { email, password, redirect: false })`. */
export const PASSWORD_PROVIDER_ID = "password";

/**
 * Stable codes NextAuth returns as `error` for a failed password sign-in; the
 * screens (A4.3) map them to copy. PasswordResetRequiredException is already
 * `invalid_credentials` in the Cognito client (A4.1), and every other outcome
 * (challenges, malformed answers, configuration failures) is `unavailable`.
 */
export const CREDENTIALS_ERROR_CODES = ["invalid_credentials", "not_confirmed", "too_many_attempts", "unavailable"] as const;
export type CredentialsErrorCode = (typeof CREDENTIALS_ERROR_CODES)[number];

/** Cognito's own limits: username/email 254 characters (RFC 5321 path), password 256. */
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

export type PasswordSessionTokens = { accessToken: string; refreshToken: string; expiresAt: number };

export type PasswordUser = { id: string; name: string | null; email: string; image: null };

export type PasswordSignInDeps = {
  /** Lazily built so a misconfigured pool answers `unavailable` instead of breaking every auth route. */
  cognito: () => Pick<CognitoClient, "signIn">;
  onServiceError?: (operation: CognitoClientOperation, errorName: string | null) => void;
};

/**
 * Tokens ride on the user object under a non-enumerable symbol: NextAuth hands
 * that same object only to the server-side `jwt` callback, and the key is
 * invisible to JSON, spreads, `Object.keys` and NextAuth's default token copy,
 * so the tokens cannot leak through a serialized or logged user.
 */
const PASSWORD_TOKENS = Symbol("peopleflow.passwordTokens");

export function takePasswordTokens(user: unknown): PasswordSessionTokens | undefined {
  if (typeof user !== "object" || user === null) return undefined;
  const tokens = (user as { [PASSWORD_TOKENS]?: PasswordSessionTokens })[PASSWORD_TOKENS];
  return tokens && typeof tokens === "object" ? tokens : undefined;
}

function fail(code: CredentialsErrorCode): never {
  // NextAuth turns the message into `?error=<code>`; nothing else is attached.
  throw new Error(code);
}

function toCode(reason: CognitoFailureReason): CredentialsErrorCode {
  return (CREDENTIALS_ERROR_CODES as readonly string[]).includes(reason) ? (reason as CredentialsErrorCode) : "unavailable";
}

function readInput(credentials: Record<string, unknown> | undefined): { email: string; password: string } {
  const email = credentials?.email;
  const password = credentials?.password;
  if (typeof email !== "string" || typeof password !== "string") fail("invalid_credentials");
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) fail("invalid_credentials");
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) fail("invalid_credentials");
  return { email, password };
}

/**
 * NextAuth `authorize` for the embedded sign-in: USER_PASSWORD_AUTH through the
 * server-only Cognito client. Returns only the identity the session shows;
 * throws `Error(<CredentialsErrorCode>)` otherwise. Never logs, and never puts
 * the email, password or a token into an error.
 */
export async function authorizePassword(
  credentials: Record<string, unknown> | undefined,
  deps: PasswordSignInDeps,
): Promise<PasswordUser> {
  const { email, password } = readInput(credentials);
  const signal = (errorName: string) => {
    try {
      deps.onServiceError?.("signIn", errorName);
    } catch {
      // An observer must never change the auth outcome.
    }
  };

  let client: Pick<CognitoClient, "signIn">;
  try {
    client = deps.cognito();
  } catch {
    signal("ConfigurationError");
    fail("unavailable");
  }

  const result = await client.signIn(email, password);
  if (!result.ok) fail(toCode(result.reason));
  if (result.kind === "challenge") {
    // NEW_PASSWORD_REQUIRED (admin-created users) and MFA have no screens yet (MFA later, L5).
    signal("ChallengeNotSupported");
    fail("unavailable");
  }

  const { accessToken, idToken, refreshToken, expiresAt } = result.tokens;
  const sub = accessTokenSubject(accessToken);
  if (sub === undefined) {
    signal("MalformedAccessToken");
    fail("unavailable");
  }

  const user: PasswordUser = { id: sub, name: idTokenDisplayName(idToken), email: email.trim().toLowerCase(), image: null };
  Object.defineProperty(user, PASSWORD_TOKENS, {
    value: { accessToken, refreshToken, expiresAt } satisfies PasswordSessionTokens,
    enumerable: false,
  });
  return user;
}

export function buildPasswordProvider(deps: PasswordSignInDeps) {
  // NextAuth merges `options` over the defaults (id "credentials"); the top-level
  // id is set too so the configured provider list reads the same.
  const provider = CredentialsProvider({
    id: PASSWORD_PROVIDER_ID,
    name: "Correo y contraseña",
    credentials: {
      email: { label: "Correo", type: "email" },
      password: { label: "Contraseña", type: "password" },
    },
    authorize: (credentials) => authorizePassword(credentials, deps),
  });
  return { ...provider, id: PASSWORD_PROVIDER_ID };
}
