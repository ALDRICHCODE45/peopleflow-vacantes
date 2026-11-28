// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SignInResult } from "./cognito";
import {
  CREDENTIALS_ERROR_CODES,
  PASSWORD_PROVIDER_ID,
  authorizePassword,
  buildPasswordProvider,
  takePasswordTokens,
} from "./credentials";

const SUB = "a1b2c3d4-5678-40ab-8def-0123456789ab";
const EMAIL = "laura@empresa.mx";
const PASSWORD = "Sup3r-secret-pass!";
const NOW = 1_795_000_000_000;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function jwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }): string {
  return `${b64url(header)}.${b64url(payload)}.c2lnbmF0dXJl`;
}
const ACCESS = jwt({ sub: SUB, token_use: "access", client_id: "app", exp: NOW / 1000 + 3600, username: SUB });
const ID = jwt({ sub: SUB, token_use: "id", email: EMAIL, name: "Laura Gómez" });
const TOKENS = { accessToken: ACCESS, idToken: ID, refreshToken: "refresh-token-value", expiresAt: NOW + 3_600_000 };

function deps(result: SignInResult | (() => never)) {
  const signIn = vi.fn(async () => (typeof result === "function" ? result() : result));
  const onServiceError = vi.fn();
  return { signIn, onServiceError, deps: { cognito: () => ({ signIn }), onServiceError } };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (reason: unknown) => reason as Error,
  );
  return error.message;
}

describe("password provider", () => {
  it("is a NextAuth credentials provider with the stable id `password`", () => {
    const provider = buildPasswordProvider(deps({ ok: true, kind: "tokens", tokens: TOKENS }).deps);
    expect(PASSWORD_PROVIDER_ID).toBe("password");
    expect(provider.id).toBe("password");
    expect(provider.type).toBe("credentials");
  });

  it("publishes the stable error codes the screens map", () => {
    expect([...CREDENTIALS_ERROR_CODES]).toEqual(["invalid_credentials", "not_confirmed", "too_many_attempts", "unavailable"]);
  });
});

describe("authorizePassword success", () => {
  it("signs in with the submitted email and password and returns only identity fields", async () => {
    const { signIn, deps: d } = deps({ ok: true, kind: "tokens", tokens: TOKENS });
    const user = await authorizePassword({ email: ` ${EMAIL} `, password: PASSWORD, csrfToken: "x" }, d);
    expect(signIn).toHaveBeenCalledExactlyOnceWith(` ${EMAIL} `, PASSWORD);
    expect(user).toEqual({ id: SUB, name: "Laura Gómez", email: EMAIL, image: null });
  });

  it("keeps the Cognito tokens off every serializable field (only the jwt callback can take them)", async () => {
    const { deps: d } = deps({ ok: true, kind: "tokens", tokens: TOKENS });
    const user = await authorizePassword({ email: EMAIL, password: PASSWORD }, d);
    const serialized = JSON.stringify(user);
    for (const secret of [ACCESS, ID, "refresh-token-value", PASSWORD]) expect(serialized).not.toContain(secret);
    expect(Object.keys(user).sort()).toEqual(["email", "id", "image", "name"]);
    expect(takePasswordTokens(user)).toEqual({ accessToken: ACCESS, refreshToken: "refresh-token-value", expiresAt: NOW + 3_600_000 });
    expect(takePasswordTokens({ ...user })).toBeUndefined();
    expect(takePasswordTokens({ id: SUB, accessToken: ACCESS })).toBeUndefined();
    expect(takePasswordTokens(null)).toBeUndefined();
  });

  it("uses the access token's sub as the subject and falls back to a null name without an ID token", async () => {
    const { deps: d } = deps({ ok: true, kind: "tokens", tokens: { ...TOKENS, idToken: undefined } });
    await expect(authorizePassword({ email: EMAIL, password: PASSWORD }, d)).resolves.toEqual({
      id: SUB, name: null, email: EMAIL, image: null,
    });
  });

  it("ignores a malformed ID token for display instead of failing the sign-in", async () => {
    const { deps: d } = deps({ ok: true, kind: "tokens", tokens: { ...TOKENS, idToken: "not-a-jwt" } });
    await expect(authorizePassword({ email: EMAIL, password: PASSWORD }, d)).resolves.toMatchObject({ name: null });
  });
});

describe("authorizePassword failure mapping", () => {
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["not_confirmed", "not_confirmed"],
    ["too_many_attempts", "too_many_attempts"],
    ["unavailable", "unavailable"],
    // Not reachable from signIn today; anything outside the closed set is unavailable.
    ["code_mismatch", "unavailable"],
    ["email_taken", "unavailable"],
  ] as const)("maps Cognito %s to %s", async (reason, code) => {
    const { deps: d } = deps({ ok: false, reason } as SignInResult);
    expect(await codeOf(authorizePassword({ email: EMAIL, password: PASSWORD }, d))).toBe(code);
  });

  it.each(["new_password_required", "mfa", "unsupported"] as const)(
    "answers the %s challenge as unavailable and signals the operator",
    async (challenge) => {
      const { deps: d, onServiceError } = deps({ ok: true, kind: "challenge", challenge });
      expect(await codeOf(authorizePassword({ email: EMAIL, password: PASSWORD }, d))).toBe("unavailable");
      expect(onServiceError).toHaveBeenCalledExactlyOnceWith("signIn", "ChallengeNotSupported");
    },
  );

  it.each([
    ["missing", {}],
    ["non-string email", { email: 42, password: PASSWORD }],
    ["blank email", { email: "   ", password: PASSWORD }],
    ["oversized email", { email: `${"a".repeat(250)}@x.mx`, password: PASSWORD }],
    ["empty password", { email: EMAIL, password: "" }],
    ["oversized password", { email: EMAIL, password: "x".repeat(257) }],
  ])("rejects %s input as invalid_credentials without calling Cognito", async (_label, input) => {
    const { deps: d, signIn } = deps({ ok: true, kind: "tokens", tokens: TOKENS });
    expect(await codeOf(authorizePassword(input as Record<string, unknown>, d))).toBe("invalid_credentials");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("rejects undefined credentials", async () => {
    const { deps: d } = deps({ ok: true, kind: "tokens", tokens: TOKENS });
    expect(await codeOf(authorizePassword(undefined, d))).toBe("invalid_credentials");
  });

  it.each([
    ["two segments", "a.b"],
    ["an unsigned token", jwt({ sub: SUB, token_use: "access" }, { alg: "none" })],
    ["an empty signature", `${b64url({ alg: "RS256" })}.${b64url({ sub: SUB, token_use: "access" })}.`],
    ["an ID token in place of the access token", jwt({ sub: SUB, token_use: "id" })],
    ["no sub", jwt({ token_use: "access" })],
    ["a sub outside the Cognito alphabet", jwt({ sub: "../../etc", token_use: "access" })],
    ["a non-JSON payload", `${b64url({ alg: "RS256" })}.bm90LWpzb24.c2ln`],
  ])("refuses %s as unavailable and signals the operator", async (_label, accessToken) => {
    const { deps: d, onServiceError } = deps({ ok: true, kind: "tokens", tokens: { ...TOKENS, accessToken } });
    expect(await codeOf(authorizePassword({ email: EMAIL, password: PASSWORD }, d))).toBe("unavailable");
    expect(onServiceError).toHaveBeenCalledExactlyOnceWith("signIn", "MalformedAccessToken");
  });

  it("answers unavailable when the Cognito client cannot be configured", async () => {
    const onServiceError = vi.fn();
    const code = await codeOf(authorizePassword({ email: EMAIL, password: PASSWORD }, {
      cognito: () => { throw new Error(`COGNITO_ISSUER: bad ${PASSWORD}`); },
      onServiceError,
    }));
    expect(code).toBe("unavailable");
    expect(onServiceError).toHaveBeenCalledExactlyOnceWith("signIn", "ConfigurationError");
  });

  it("never puts the password, email or tokens into an error or a log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const reasons: SignInResult[] = [
      { ok: false, reason: "invalid_credentials" },
      { ok: false, reason: "unavailable" },
      { ok: true, kind: "challenge", challenge: "mfa" },
      { ok: true, kind: "tokens", tokens: { ...TOKENS, accessToken: "x.y" } },
    ];
    for (const result of reasons) {
      const { deps: d, onServiceError } = deps(result);
      const failure = await authorizePassword({ email: EMAIL, password: PASSWORD }, d).catch((e: unknown) => e as Error);
      const text = JSON.stringify({ message: (failure as Error).message, stack: (failure as Error).stack, calls: onServiceError.mock.calls });
      for (const secret of [PASSWORD, EMAIL, ACCESS, "refresh-token-value"]) expect(text).not.toContain(secret);
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
