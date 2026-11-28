import "server-only";
import type { CognitoClientConfig } from "./config";
import { mapCognitoError, type CognitoClientOperation, type CognitoFailureReason } from "./errors";
import { computeSecretHash } from "./secret-hash";
import { callCognito, type CognitoOperation } from "./transport";

export type { CognitoFailureReason } from "./errors";

/**
 * Our password requirements, stated instead of echoing Cognito's policy
 * message. They must match the user pool's password policy (Cognito default:
 * 8+ characters with lowercase, uppercase, number and symbol); the screens
 * render them from these ids.
 */
export const PASSWORD_REQUIREMENTS = ["min_length_8", "lowercase", "uppercase", "number", "symbol"] as const;
export type PasswordRequirement = (typeof PASSWORD_REQUIREMENTS)[number];

export type CognitoFailure =
  | { ok: false; reason: Exclude<CognitoFailureReason, "invalid_password"> }
  | { ok: false; reason: "invalid_password"; requirements: typeof PASSWORD_REQUIREMENTS };

export type CognitoTokens = {
  accessToken: string;
  idToken?: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

/** The challenge session is deliberately not exposed until MFA is built (L5). */
export type SignInChallenge = "new_password_required" | "mfa" | "unsupported";

export type SignInResult =
  | { ok: true; kind: "tokens"; tokens: CognitoTokens }
  | { ok: true; kind: "challenge"; challenge: SignInChallenge }
  | CognitoFailure;
export type RefreshResult = { ok: true; tokens: CognitoTokens } | CognitoFailure;
export type SignUpResult = { ok: true; confirmed: boolean } | CognitoFailure;
export type CognitoOkResult = { ok: true } | CognitoFailure;

export type CognitoClient = {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** SECRET_HASH uses the `sub`, as real Cognito requires for REFRESH_TOKEN_AUTH (L9). */
  refresh(refreshToken: string, sub: string): Promise<RefreshResult>;
  signUp(email: string, password: string, name: string): Promise<SignUpResult>;
  confirmSignUp(email: string, code: string): Promise<CognitoOkResult>;
  resendCode(email: string): Promise<CognitoOkResult>;
  forgotPassword(email: string): Promise<CognitoOkResult>;
  confirmForgotPassword(email: string, code: string, newPassword: string): Promise<CognitoOkResult>;
};

export type CognitoClientOptions = CognitoClientConfig & {
  /** Defaults to the shared API timeout (DEFAULT_API_TIMEOUT_MS). */
  timeoutMs?: number;
  now?: () => number;
};

const MFA_CHALLENGES = new Set(["SMS_MFA", "SOFTWARE_TOKEN_MFA", "EMAIL_OTP", "MFA_SETUP", "SELECT_MFA_TYPE"]);
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

function failure(reason: CognitoFailureReason): CognitoFailure {
  return reason === "invalid_password"
    ? { ok: false, reason, requirements: PASSWORD_REQUIREMENTS }
    : { ok: false, reason };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Server-only Cognito user pools API client for the embedded auth screens.
 * Every result is a closed union: no thrown errors, no Cognito messages, no
 * echoed passwords, codes or tokens, nothing logged.
 */
export function createCognitoClient(options: CognitoClientOptions): CognitoClient {
  const { endpoint, clientId, clientSecret, timeoutMs, now = Date.now } = options;
  const hash = (username: string) => computeSecretHash(username, clientId, clientSecret);

  type Outcome = { ok: true; body: Record<string, unknown> } | CognitoFailure | { ok: true; silent: true };

  async function call(
    operation: CognitoClientOperation,
    target: CognitoOperation,
    payload: Record<string, unknown>,
  ): Promise<Outcome> {
    const result = await callCognito(endpoint, target, payload, { timeoutMs });
    if (result.ok) return result;
    if (result.kind === "unavailable") return UNAVAILABLE;
    const mapped = mapCognitoError(operation, result.errorName);
    return mapped === "ok" ? { ok: true, silent: true } : failure(mapped);
  }

  function parseTokens(body: Record<string, unknown>, fallbackRefreshToken?: string): CognitoTokens | undefined {
    const auth = body.AuthenticationResult;
    if (!isObject(auth)) return undefined;
    const { AccessToken, ExpiresIn, IdToken, RefreshToken } = auth;
    if (!nonEmptyString(AccessToken)) return undefined;
    if (typeof ExpiresIn !== "number" || !Number.isSafeInteger(ExpiresIn) || ExpiresIn <= 0 || ExpiresIn > MAX_EXPIRES_IN_SECONDS)
      return undefined;
    const refreshToken = nonEmptyString(RefreshToken) ? RefreshToken : fallbackRefreshToken;
    if (refreshToken === undefined) return undefined;
    return {
      accessToken: AccessToken,
      ...(nonEmptyString(IdToken) ? { idToken: IdToken } : {}),
      refreshToken,
      expiresAt: now() + ExpiresIn * 1000,
    };
  }

  async function okOnly(
    operation: CognitoClientOperation,
    target: CognitoOperation,
    payload: Record<string, unknown>,
  ): Promise<CognitoOkResult> {
    const outcome = await call(operation, target, payload);
    return outcome.ok ? { ok: true } : outcome;
  }

  return {
    async signIn(email, password) {
      const outcome = await call("signIn", "InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: hash(email) },
      });
      if (!outcome.ok) return outcome;
      if (!("body" in outcome)) return UNAVAILABLE;
      const tokens = parseTokens(outcome.body);
      if (tokens) return { ok: true, kind: "tokens", tokens };
      const challenge = outcome.body.ChallengeName;
      if (outcome.body.AuthenticationResult === undefined && nonEmptyString(challenge)) {
        return {
          ok: true,
          kind: "challenge",
          challenge:
            challenge === "NEW_PASSWORD_REQUIRED" ? "new_password_required" : MFA_CHALLENGES.has(challenge) ? "mfa" : "unsupported",
        };
      }
      return UNAVAILABLE;
    },

    async refresh(refreshToken, sub) {
      const outcome = await call("refresh", "InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: hash(sub) },
      });
      if (!outcome.ok) return outcome;
      if (!("body" in outcome)) return UNAVAILABLE;
      const tokens = parseTokens(outcome.body, refreshToken);
      return tokens ? { ok: true, tokens } : UNAVAILABLE;
    },

    async signUp(email, password, name) {
      const outcome = await call("signUp", "SignUp", {
        ClientId: clientId,
        SecretHash: hash(email),
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
        ],
      });
      if (!outcome.ok) return outcome;
      if (!("body" in outcome)) return UNAVAILABLE;
      const confirmed = outcome.body.UserConfirmed;
      return typeof confirmed === "boolean" ? { ok: true, confirmed } : UNAVAILABLE;
    },

    confirmSignUp(email, code) {
      return okOnly("confirmSignUp", "ConfirmSignUp", {
        ClientId: clientId,
        SecretHash: hash(email),
        Username: email,
        ConfirmationCode: code,
      });
    },

    resendCode(email) {
      return okOnly("resendCode", "ResendConfirmationCode", {
        ClientId: clientId,
        SecretHash: hash(email),
        Username: email,
      });
    },

    forgotPassword(email) {
      return okOnly("forgotPassword", "ForgotPassword", {
        ClientId: clientId,
        SecretHash: hash(email),
        Username: email,
      });
    },

    confirmForgotPassword(email, code, newPassword) {
      return okOnly("confirmForgotPassword", "ConfirmForgotPassword", {
        ClientId: clientId,
        SecretHash: hash(email),
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      });
    },
  };
}
