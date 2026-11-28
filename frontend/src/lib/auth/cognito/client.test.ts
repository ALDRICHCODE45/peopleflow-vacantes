// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_REQUIREMENTS, createCognitoClient, type CognitoClient } from "./client";
import { computeSecretHash } from "./secret-hash";

const ENDPOINT = "https://cognito-idp.us-east-1.amazonaws.com/";
const CLIENT_ID = "1example23456789app";
const CLIENT_SECRET = "example-client-secret-value";
const EMAIL = "laura@empresa.mx";
const SUB = "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111";
const PASSWORD = "Sup3r-secret-pass!";
const CODE = "123456";
const NOW = 1_795_000_000_000;

const fetchMock = vi.fn<typeof fetch>();
let client: CognitoClient;

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/x-amz-json-1.1", ...headers },
  });
}
function cognitoError(name: string, message = "Cognito says something revealing") {
  return reply(name === "InternalErrorException" ? 500 : 400, { __type: name, message }, { "x-amzn-errortype": name });
}
function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    target: new Headers(init?.headers).get("x-amz-target"),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}
const AUTH_RESULT = {
  AuthenticationResult: {
    AccessToken: "access.jwt.value",
    ExpiresIn: 3600,
    IdToken: "id.jwt.value",
    RefreshToken: "refresh-token-value",
    TokenType: "Bearer",
  },
  ChallengeParameters: {},
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = createCognitoClient({
    endpoint: ENDPOINT,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    now: () => NOW,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("request shapes", () => {
  it("signIn → InitiateAuth USER_PASSWORD_AUTH with SECRET_HASH of the email", async () => {
    fetchMock.mockResolvedValue(reply(200, AUTH_RESULT));
    await client.signIn(EMAIL, PASSWORD);
    expect(lastRequest()).toEqual({
      url: ENDPOINT,
      target: "AWSCognitoIdentityProviderService.InitiateAuth",
      body: {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: EMAIL,
          PASSWORD,
          SECRET_HASH: computeSecretHash(EMAIL, CLIENT_ID, CLIENT_SECRET),
        },
      },
    });
  });

  it("refresh → InitiateAuth REFRESH_TOKEN_AUTH with SECRET_HASH of the sub (not the email)", async () => {
    fetchMock.mockResolvedValue(reply(200, AUTH_RESULT));
    await client.refresh("refresh-token-value", SUB);
    expect(lastRequest().body).toEqual({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: "refresh-token-value",
        SECRET_HASH: computeSecretHash(SUB, CLIENT_ID, CLIENT_SECRET),
      },
    });
    expect(lastRequest().target).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
  });

  it("signUp → SignUp with email username, email + name attributes and SecretHash", async () => {
    fetchMock.mockResolvedValue(reply(200, { UserConfirmed: false, UserSub: SUB }));
    await client.signUp(EMAIL, PASSWORD, "Laura Pérez");
    expect(lastRequest().target).toBe("AWSCognitoIdentityProviderService.SignUp");
    expect(lastRequest().body).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: computeSecretHash(EMAIL, CLIENT_ID, CLIENT_SECRET),
      Username: EMAIL,
      Password: PASSWORD,
      UserAttributes: [
        { Name: "email", Value: EMAIL },
        { Name: "name", Value: "Laura Pérez" },
      ],
    });
  });

  it.each([
    ["confirmSignUp", "ConfirmSignUp", (c: CognitoClient) => c.confirmSignUp(EMAIL, CODE), { ConfirmationCode: CODE }],
    ["resendCode", "ResendConfirmationCode", (c: CognitoClient) => c.resendCode(EMAIL), {}],
    ["forgotPassword", "ForgotPassword", (c: CognitoClient) => c.forgotPassword(EMAIL), {}],
    [
      "confirmForgotPassword",
      "ConfirmForgotPassword",
      (c: CognitoClient) => c.confirmForgotPassword(EMAIL, CODE, PASSWORD),
      { ConfirmationCode: CODE, Password: PASSWORD },
    ],
  ] as const)("%s → %s with Username and SecretHash", async (_name, op, call, extra) => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await call(client);
    expect(lastRequest().target).toBe(`AWSCognitoIdentityProviderService.${op}`);
    expect(lastRequest().body).toEqual({
      ClientId: CLIENT_ID,
      SecretHash: computeSecretHash(EMAIL, CLIENT_ID, CLIENT_SECRET),
      Username: EMAIL,
      ...extra,
    });
  });
});

describe("success results", () => {
  it("signIn returns the tokens with an absolute expiry", async () => {
    fetchMock.mockResolvedValue(reply(200, AUTH_RESULT));
    await expect(client.signIn(EMAIL, PASSWORD)).resolves.toEqual({
      ok: true,
      kind: "tokens",
      tokens: {
        accessToken: "access.jwt.value",
        idToken: "id.jwt.value",
        refreshToken: "refresh-token-value",
        expiresAt: NOW + 3600 * 1000,
      },
    });
  });

  it.each([
    ["NEW_PASSWORD_REQUIRED", "new_password_required"],
    ["SOFTWARE_TOKEN_MFA", "mfa"],
    ["SMS_MFA", "mfa"],
    ["EMAIL_OTP", "mfa"],
    ["MFA_SETUP", "mfa"],
    ["SELECT_MFA_TYPE", "mfa"],
    ["CUSTOM_CHALLENGE", "unsupported"],
  ])("signIn maps challenge %s to kind %s without exposing the session", async (name, kind) => {
    fetchMock.mockResolvedValue(reply(200, { ChallengeName: name, Session: "opaque-session", ChallengeParameters: {} }));
    const result = await client.signIn(EMAIL, PASSWORD);
    expect(result).toEqual({ ok: true, kind: "challenge", challenge: kind });
    expect(JSON.stringify(result)).not.toContain("opaque-session");
  });

  it("refresh keeps the given refresh token when Cognito does not rotate it", async () => {
    const rest: Record<string, unknown> = { ...AUTH_RESULT.AuthenticationResult };
    delete rest.RefreshToken;
    fetchMock.mockResolvedValue(reply(200, { AuthenticationResult: rest }));
    await expect(client.refresh("refresh-token-value", SUB)).resolves.toEqual({
      ok: true,
      tokens: {
        accessToken: "access.jwt.value",
        idToken: "id.jwt.value",
        refreshToken: "refresh-token-value",
        expiresAt: NOW + 3600 * 1000,
      },
    });
  });

  it("signUp reports only whether the user is already confirmed", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        UserConfirmed: false,
        UserSub: SUB,
        CodeDeliveryDetails: { Destination: "l***@e***", DeliveryMedium: "EMAIL", AttributeName: "email" },
      }),
    );
    await expect(client.signUp(EMAIL, PASSWORD, "Laura")).resolves.toEqual({ ok: true, confirmed: false });
  });

  it.each([
    ["confirmSignUp", (c: CognitoClient) => c.confirmSignUp(EMAIL, CODE)],
    ["confirmForgotPassword", (c: CognitoClient) => c.confirmForgotPassword(EMAIL, CODE, PASSWORD)],
    ["resendCode", (c: CognitoClient) => c.resendCode(EMAIL)],
    ["forgotPassword", (c: CognitoClient) => c.forgotPassword(EMAIL)],
  ] as const)("%s returns ok without delivery details", async (_name, call) => {
    fetchMock.mockResolvedValue(
      reply(200, { CodeDeliveryDetails: { Destination: "l***@e***", DeliveryMedium: "EMAIL" } }),
    );
    await expect(call(client)).resolves.toEqual({ ok: true });
  });

  it.each([
    ["no AuthenticationResult and no challenge", {}],
    ["empty access token", { AuthenticationResult: { ...AUTH_RESULT.AuthenticationResult, AccessToken: "" } }],
    ["non-positive ExpiresIn", { AuthenticationResult: { ...AUTH_RESULT.AuthenticationResult, ExpiresIn: 0 } }],
    ["fractional ExpiresIn", { AuthenticationResult: { ...AUTH_RESULT.AuthenticationResult, ExpiresIn: 1.5 } }],
    ["string ExpiresIn", { AuthenticationResult: { ...AUTH_RESULT.AuthenticationResult, ExpiresIn: "3600" } }],
    ["missing refresh token on sign-in", { AuthenticationResult: { ...AUTH_RESULT.AuthenticationResult, RefreshToken: undefined } }],
  ])("signIn treats a malformed success (%s) as unavailable", async (_label, body) => {
    fetchMock.mockResolvedValue(reply(200, body));
    await expect(client.signIn(EMAIL, PASSWORD)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("signUp treats a missing UserConfirmed as unavailable", async () => {
    fetchMock.mockResolvedValue(reply(200, { UserSub: SUB }));
    await expect(client.signUp(EMAIL, PASSWORD, "Laura")).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

type Call = (c: CognitoClient) => Promise<unknown>;
const signIn: Call = (c) => c.signIn(EMAIL, PASSWORD);
const refresh: Call = (c) => c.refresh("refresh-token-value", SUB);
const signUp: Call = (c) => c.signUp(EMAIL, PASSWORD, "Laura");
const confirmSignUp: Call = (c) => c.confirmSignUp(EMAIL, CODE);
const resendCode: Call = (c) => c.resendCode(EMAIL);
const forgotPassword: Call = (c) => c.forgotPassword(EMAIL);
const confirmForgotPassword: Call = (c) => c.confirmForgotPassword(EMAIL, CODE, PASSWORD);

describe("error mapping (closed reasons)", () => {
  it.each([
    // signIn: wrong password and unknown user are indistinguishable.
    ["signIn", signIn, "NotAuthorizedException", "invalid_credentials"],
    ["signIn", signIn, "UserNotFoundException", "invalid_credentials"],
    ["signIn", signIn, "PasswordResetRequiredException", "invalid_credentials"],
    ["signIn", signIn, "UserNotConfirmedException", "not_confirmed"],
    ["signIn", signIn, "TooManyRequestsException", "too_many_attempts"],
    ["signIn", signIn, "LimitExceededException", "too_many_attempts"],
    ["signIn", signIn, "TooManyFailedAttemptsException", "too_many_attempts"],
    ["signIn", signIn, "InvalidParameterException", "unavailable"],
    ["signIn", signIn, "ResourceNotFoundException", "unavailable"],
    ["signIn", signIn, "InternalErrorException", "unavailable"],
    ["signIn", signIn, "SomethingNewException", "unavailable"],
    // refresh: a revoked/expired refresh token or a deleted user ends the session.
    ["refresh", refresh, "NotAuthorizedException", "invalid_credentials"],
    ["refresh", refresh, "UserNotFoundException", "invalid_credentials"],
    ["refresh", refresh, "TooManyRequestsException", "too_many_attempts"],
    ["refresh", refresh, "InternalErrorException", "unavailable"],
    // signUp: the only caller that may learn an email is taken (documented trade-off).
    ["signUp", signUp, "UsernameExistsException", "email_taken"],
    ["signUp", signUp, "InvalidPasswordException", "invalid_password"],
    ["signUp", signUp, "TooManyRequestsException", "too_many_attempts"],
    ["signUp", signUp, "LimitExceededException", "too_many_attempts"],
    ["signUp", signUp, "CodeDeliveryFailureException", "unavailable"],
    ["signUp", signUp, "InvalidParameterException", "unavailable"],
    // confirmSignUp: unknown user / already-confirmed look like a wrong code.
    ["confirmSignUp", confirmSignUp, "CodeMismatchException", "code_mismatch"],
    ["confirmSignUp", confirmSignUp, "ExpiredCodeException", "code_expired"],
    ["confirmSignUp", confirmSignUp, "UserNotFoundException", "code_mismatch"],
    ["confirmSignUp", confirmSignUp, "NotAuthorizedException", "code_mismatch"],
    ["confirmSignUp", confirmSignUp, "AliasExistsException", "code_mismatch"],
    ["confirmSignUp", confirmSignUp, "TooManyFailedAttemptsException", "too_many_attempts"],
    ["confirmSignUp", confirmSignUp, "LimitExceededException", "too_many_attempts"],
    ["confirmSignUp", confirmSignUp, "InternalErrorException", "unavailable"],
    // confirmForgotPassword
    ["confirmForgotPassword", confirmForgotPassword, "CodeMismatchException", "code_mismatch"],
    ["confirmForgotPassword", confirmForgotPassword, "ExpiredCodeException", "code_expired"],
    ["confirmForgotPassword", confirmForgotPassword, "UserNotFoundException", "code_mismatch"],
    ["confirmForgotPassword", confirmForgotPassword, "UserNotConfirmedException", "code_mismatch"],
    ["confirmForgotPassword", confirmForgotPassword, "NotAuthorizedException", "code_mismatch"],
    ["confirmForgotPassword", confirmForgotPassword, "InvalidPasswordException", "invalid_password"],
    ["confirmForgotPassword", confirmForgotPassword, "TooManyFailedAttemptsException", "too_many_attempts"],
    ["confirmForgotPassword", confirmForgotPassword, "TooManyRequestsException", "too_many_attempts"],
    // resend / forgot: throttling and outages surface; everything about the account does not.
    ["resendCode", resendCode, "LimitExceededException", "too_many_attempts"],
    ["resendCode", resendCode, "TooManyRequestsException", "too_many_attempts"],
    ["resendCode", resendCode, "CodeDeliveryFailureException", "unavailable"],
    ["forgotPassword", forgotPassword, "LimitExceededException", "too_many_attempts"],
    ["forgotPassword", forgotPassword, "TooManyRequestsException", "too_many_attempts"],
    ["forgotPassword", forgotPassword, "InternalErrorException", "unavailable"],
  ] as const)("%s: %s → %s", async (_op, call, errorName, reason) => {
    fetchMock.mockResolvedValue(cognitoError(errorName));
    const result = await call(client);
    expect(result).toMatchObject({ ok: false, reason });
  });

  it.each([
    ["resendCode", resendCode, "UserNotFoundException"],
    ["resendCode", resendCode, "InvalidParameterException"], // already confirmed
    ["resendCode", resendCode, "NotAuthorizedException"],
    ["forgotPassword", forgotPassword, "UserNotFoundException"],
    ["forgotPassword", forgotPassword, "UserNotConfirmedException"],
    ["forgotPassword", forgotPassword, "InvalidParameterException"], // no verified email
    ["forgotPassword", forgotPassword, "NotAuthorizedException"],
  ] as const)("%s hides account state: %s → ok, same as a delivered code", async (_op, call, errorName) => {
    fetchMock.mockResolvedValue(cognitoError(errorName));
    await expect(call(client)).resolves.toEqual({ ok: true });
  });

  it("invalid_password carries our requirements, never Cognito's policy message", async () => {
    fetchMock.mockResolvedValue(
      cognitoError("InvalidPasswordException", "Password did not conform with policy: Password must have symbol characters"),
    );
    const result = await client.signUp(EMAIL, PASSWORD, "Laura");
    expect(result).toEqual({ ok: false, reason: "invalid_password", requirements: PASSWORD_REQUIREMENTS });
    expect(JSON.stringify(result)).not.toMatch(/policy|symbol characters/);
  });

  it("states our requirements as a closed, ordered list", () => {
    expect(PASSWORD_REQUIREMENTS).toEqual(["min_length_8", "lowercase", "uppercase", "number", "symbol"]);
  });

  it.each([
    ["signIn", signIn],
    ["refresh", refresh],
    ["signUp", signUp],
    ["confirmSignUp", confirmSignUp],
    ["resendCode", resendCode],
    ["forgotPassword", forgotPassword],
    ["confirmForgotPassword", confirmForgotPassword],
  ] as const)("%s maps a network failure to unavailable", async (_op, call) => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(call(client)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("no secret material leaks", () => {
  const SECRETS = [PASSWORD, CODE, "refresh-token-value", CLIENT_SECRET, "Cognito says something revealing"];

  it.each([
    ["signIn", signIn],
    ["refresh", refresh],
    ["signUp", signUp],
    ["confirmSignUp", confirmSignUp],
    ["confirmForgotPassword", confirmForgotPassword],
  ] as const)("%s failures carry no password, code, token, secret or Cognito message, and nothing is logged", async (_op, call) => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      for (const name of ["NotAuthorizedException", "CodeMismatchException", "InvalidPasswordException", "InternalErrorException"]) {
        fetchMock.mockResolvedValueOnce(cognitoError(name));
        const serialized = JSON.stringify(await call(client));
        for (const secret of SECRETS) expect(serialized).not.toContain(secret);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
