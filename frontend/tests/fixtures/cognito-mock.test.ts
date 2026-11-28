import { createHmac, createPublicKey, createVerify } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

// Defaults of tests/fixtures/cognito-mock.mjs (overridable by env, see README).
const CLIENT_ID = "peopleflow-e2e";
const CLIENT_SECRET = "peopleflow-e2e-secret";
const ISSUER = "https://e2e.peopleflow.test/identity";
const AUDIENCE = "peopleflow-e2e";
const PASSWORD = "Sup3r-secret-pass!";

let server: ChildProcess;
let origin: string;

beforeAll(async () => {
  server = spawn(process.execPath, ["tests/fixtures/cognito-mock.mjs"], {
    env: { ...process.env, COGNITO_MOCK_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [chunk] = await once(server.stdout!, "data");
  origin = `http://127.0.0.1:${String(chunk).match(/cognito mock listening on (\d+)/)![1]}`;
});
afterAll(async () => {
  const closed = once(server, "exit");
  server.kill("SIGTERM");
  await closed;
});
beforeEach(async () => {
  expect((await fetch(`${origin}/__cognito/reset`, { method: "POST" })).status).toBe(200);
});

const secretHash = (username: string) =>
  createHmac("sha256", CLIENT_SECRET).update(username + CLIENT_ID).digest("base64");

async function cognito(op: string, body: unknown, init: { contentType?: string; path?: string; method?: string } = {}) {
  const response = await fetch(`${origin}${init.path ?? "/"}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": init.contentType ?? "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${op}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, errorType: response.headers.get("x-amzn-errortype"), json };
}
const expectError = (result: Awaited<ReturnType<typeof cognito>>, name: string, status = 400) => {
  expect(result.status).toBe(status);
  expect(result.errorType).toBe(name);
  expect(result.json.__type).toBe(name);
  expect(typeof result.json.message).toBe("string");
};

async function control(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}/__cognito${path}`, init);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}
const codes = async (email: string) => (await control(`/codes?email=${encodeURIComponent(email)}`)).json;
const seed = async (user: Record<string, unknown>) =>
  control("/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) });

const signUp = (email: string, password = PASSWORD, hash = secretHash(email)) =>
  cognito("SignUp", {
    ClientId: CLIENT_ID,
    SecretHash: hash,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: "Laura" }],
  });
const signIn = (email: string, password = PASSWORD) =>
  cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash(email) },
  });
const confirm = (email: string, code: string) =>
  cognito("ConfirmSignUp", { ClientId: CLIENT_ID, SecretHash: secretHash(email), Username: email, ConfirmationCode: code });

function decodeJwt(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString()),
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature!, "base64url"),
  };
}
async function publicKeyPem() {
  const response = await fetch(`${origin}/__cognito/public-key`);
  expect(response.status).toBe(200);
  return response.text();
}

describe("request contract", () => {
  test.each<[string, { path?: string; contentType?: string; method?: string }]>([
    ["wrong path", { path: "/v1" }],
    ["wrong content type", { contentType: "application/json" }],
    ["GET", { method: "GET" }],
  ])("refuses a %s with SerializationException", async (_label, init) => {
    const result = await fetch(`${origin}${init.path ?? "/"}`, {
      method: init.method ?? "POST",
      headers: {
        "content-type": init.contentType ?? "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.SignUp",
      },
      ...(init.method === "GET" ? {} : { body: "{}" }),
    });
    expect(result.status).toBe(400);
    expect(((await result.json()) as { __type: string }).__type).toBe("SerializationException");
  });

  test("refuses an unknown operation and a non-object body", async () => {
    expectError(await cognito("AdminCreateUser", {}), "SerializationException");
    expectError(await cognito("SignUp", "[1]"), "SerializationException");
    expectError(await cognito("SignUp", "{not json"), "SerializationException");
  });

  test("refuses an unknown client id", async () => {
    const result = await cognito("SignUp", { ClientId: "other", SecretHash: "x", Username: "a@b.mx", Password: PASSWORD });
    expectError(result, "ResourceNotFoundException");
  });
});

describe("sign-up and confirmation", () => {
  test("verifies SECRET_HASH", async () => {
    expectError(await signUp("laura@empresa.mx", PASSWORD, secretHash("other@empresa.mx")), "NotAuthorizedException");
    const ok = await signUp("laura@empresa.mx");
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ UserConfirmed: false, CodeDeliveryDetails: { DeliveryMedium: "EMAIL", AttributeName: "email" } });
    expect(typeof ok.json.UserSub).toBe("string");
  });

  test("requires the name attribute, like the real pool (L20: required attributes email and name)", async () => {
    const base = { ClientId: CLIENT_ID, SecretHash: secretHash("laura@empresa.mx"), Username: "laura@empresa.mx", Password: PASSWORD };
    for (const UserAttributes of [undefined, [{ Name: "email", Value: "laura@empresa.mx" }], [{ Name: "name", Value: "  " }], [{ Name: "name", Value: 7 }]]) {
      const result = await cognito("SignUp", { ...base, ...(UserAttributes ? { UserAttributes } : {}) });
      expectError(result, "InvalidParameterException");
      expect(result.json.message).toMatch(/name: The attribute is required/);
    }
    // Nothing was created: the same email can still sign up with a name.
    expect((await signUp("laura@empresa.mx")).status).toBe(200);
  });

  test("enforces the password policy and unique usernames", async () => {
    expectError(await signUp("laura@empresa.mx", "short"), "InvalidPasswordException");
    expectError(await signUp("laura@empresa.mx", "alllowercase1!"), "InvalidPasswordException");
    expect((await signUp("laura@empresa.mx")).status).toBe(200);
    expectError(await signUp("laura@empresa.mx"), "UsernameExistsException");
  });

  test("an unconfirmed user cannot sign in until the confirmation code is used", async () => {
    await signUp("laura@empresa.mx");
    expectError(await signIn("laura@empresa.mx"), "UserNotConfirmedException");
    const { confirmation } = await codes("laura@empresa.mx");
    expect(confirmation).toMatch(/^\d{6}$/);
    expectError(await confirm("laura@empresa.mx", confirmation === "000000" ? "111111" : "000000"), "CodeMismatchException");
    expect((await confirm("laura@empresa.mx", String(confirmation))).status).toBe(200);
    expect((await signIn("laura@empresa.mx")).status).toBe(200);
  });

  test("hides account existence on confirm and resend", async () => {
    expectError(await confirm("ghost@empresa.mx", "123456"), "CodeMismatchException");
    const resend = await cognito("ResendConfirmationCode", { ClientId: CLIENT_ID, SecretHash: secretHash("ghost@empresa.mx"), Username: "ghost@empresa.mx" });
    expect(resend.status).toBe(200);
    expect(resend.json).toMatchObject({ CodeDeliveryDetails: { DeliveryMedium: "EMAIL" } });
  });

  test("resend issues a new code; expired and brute-forced codes are refused", async () => {
    await signUp("laura@empresa.mx");
    const first = (await codes("laura@empresa.mx")).confirmation;
    await control("/expire-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "laura@empresa.mx", kind: "confirmation" }) });
    expectError(await confirm("laura@empresa.mx", String(first)), "ExpiredCodeException");

    const resend = await cognito("ResendConfirmationCode", { ClientId: CLIENT_ID, SecretHash: secretHash("laura@empresa.mx"), Username: "laura@empresa.mx" });
    expect(resend.status).toBe(200);
    const second = String((await codes("laura@empresa.mx")).confirmation);
    const wrong = second === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i += 1) expectError(await confirm("laura@empresa.mx", wrong), "CodeMismatchException");
    expectError(await confirm("laura@empresa.mx", second), "TooManyFailedAttemptsException");
  });
});

describe("sign-in, tokens and refresh", () => {
  test("usernames are exact (no case folding or trimming), so the client must normalize", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD });
    expectError(await signIn("Laura@empresa.mx"), "NotAuthorizedException");
    expectError(await signIn(" laura@empresa.mx"), "NotAuthorizedException");
    expect((await signIn("laura@empresa.mx")).status).toBe(200);
  });

  test("wrong password and unknown user get the same NotAuthorizedException", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD });
    const wrong = await signIn("laura@empresa.mx", "Wrong-pass-123!");
    const ghost = await signIn("ghost@empresa.mx");
    expectError(wrong, "NotAuthorizedException");
    expectError(ghost, "NotAuthorizedException");
    expect(wrong.json).toEqual(ghost.json);
  });

  test("issues RS256 access tokens with the contract claims, verifiable with the published public key", async () => {
    const seeded = await seed({ email: "laura@empresa.mx", password: PASSWORD, sub: "e2e-employer-0001" });
    expect(seeded).toEqual({ status: 201, json: { sub: "e2e-employer-0001" } });
    const result = await signIn("laura@empresa.mx");
    expect(result.status).toBe(200);
    const auth = result.json.AuthenticationResult as Record<string, unknown>;
    expect(auth).toMatchObject({ ExpiresIn: 3600, TokenType: "Bearer" });
    expect(typeof auth.RefreshToken).toBe("string");
    expect(typeof auth.IdToken).toBe("string");

    const pem = await publicKeyPem();
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).not.toMatch(/PRIVATE/);
    const token = decodeJwt(String(auth.AccessToken));
    expect(token.header).toEqual({ alg: "RS256", typ: "JWT", kid: "e2e" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(token.signingInput);
    expect(verifier.verify(createPublicKey(pem), token.signature)).toBe(true);
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(token.payload).toMatchObject({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "e2e-employer-0001",
      token_use: "access",
      client_id: CLIENT_ID,
      username: "e2e-employer-0001",
      scope: "aws.cognito.signin.user.admin",
    });
    expect(token.payload.iat).toBeLessThanOrEqual(nowSeconds);
    expect(token.payload.exp).toBe(token.payload.iat + 3600);
  });

  test("REFRESH_TOKEN_AUTH requires SECRET_HASH computed with the sub", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD, sub: "sub-123" });
    const refreshToken = String(((await signIn("laura@empresa.mx")).json.AuthenticationResult as Record<string, unknown>).RefreshToken);
    const refresh = (hash: string) =>
      cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: CLIENT_ID, AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: hash } });
    expectError(await refresh(secretHash("laura@empresa.mx")), "NotAuthorizedException");
    const ok = await refresh(secretHash("sub-123"));
    expect(ok.status).toBe(200);
    const auth = ok.json.AuthenticationResult as Record<string, unknown>;
    expect(auth.RefreshToken).toBeUndefined();
    expect(decodeJwt(String(auth.AccessToken)).payload.sub).toBe("sub-123");
    expectError(
      await cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: CLIENT_ID, AuthParameters: { REFRESH_TOKEN: "forged", SECRET_HASH: secretHash("sub-123") } }),
      "NotAuthorizedException",
    );
  });

  test("refuses other auth flows", async () => {
    expectError(await cognito("InitiateAuth", { AuthFlow: "USER_SRP_AUTH", ClientId: CLIENT_ID, AuthParameters: {} }), "InvalidParameterException");
  });
});

describe("forgot password", () => {
  const forgot = (email: string) =>
    cognito("ForgotPassword", { ClientId: CLIENT_ID, SecretHash: secretHash(email), Username: email });
  const confirmForgot = (email: string, code: string, password: string) =>
    cognito("ConfirmForgotPassword", { ClientId: CLIENT_ID, SecretHash: secretHash(email), Username: email, ConfirmationCode: code, Password: password });

  test("hides account existence and resets the password with the emailed code", async () => {
    const ghost = await forgot("ghost@empresa.mx");
    expect(ghost.status).toBe(200);
    expectError(await confirmForgot("ghost@empresa.mx", "123456", "N3w-secret-pass!"), "CodeMismatchException");

    await seed({ email: "laura@empresa.mx", password: PASSWORD });
    const known = await forgot("laura@empresa.mx");
    expect(known.status).toBe(200);
    expect(Object.keys(known.json)).toEqual(Object.keys(ghost.json));
    const { reset } = await codes("laura@empresa.mx");
    expect(reset).toMatch(/^\d{6}$/);
    expectError(await confirmForgot("laura@empresa.mx", String(reset), "weak"), "InvalidPasswordException");
    expect((await confirmForgot("laura@empresa.mx", String(reset), "N3w-secret-pass!")).status).toBe(200);
    expectError(await signIn("laura@empresa.mx"), "NotAuthorizedException");
    expect((await signIn("laura@empresa.mx", "N3w-secret-pass!")).status).toBe(200);
    expectError(await confirmForgot("laura@empresa.mx", String(reset), "An0ther-pass!!"), "CodeMismatchException");
  });
});

describe("GetUser (contract stub shapes)", () => {
  const getUser = (token: unknown) => cognito("GetUser", { AccessToken: token });
  const accessFor = async (email: string) =>
    String(((await signIn(email)).json.AuthenticationResult as Record<string, unknown>).AccessToken);

  test("success: sub, email_verified true, email", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD, sub: "e2e-employer-0001" });
    const result = await getUser(await accessFor("laura@empresa.mx"));
    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      Username: "e2e-employer-0001",
      UserAttributes: [
        { Name: "sub", Value: "e2e-employer-0001" },
        { Name: "email_verified", Value: "true" },
        { Name: "email", Value: "laura@empresa.mx" },
      ],
    });
  });

  test("unverified email", async () => {
    await seed({ email: "nora@empresa.mx", password: PASSWORD, sub: "e2e-unverified", emailVerified: false });
    const result = await getUser(await accessFor("nora@empresa.mx"));
    expect(result.status).toBe(200);
    expect(result.json.UserAttributes).toContainEqual({ Name: "email_verified", Value: "false" });
  });

  test("invalid, tampered or orphaned token → NotAuthorizedException", async () => {
    expectError(await getUser("not-a-jwt"), "NotAuthorizedException");
    await seed({ email: "laura@empresa.mx", password: PASSWORD, sub: "e2e-employer-0001" });
    const token = await accessFor("laura@empresa.mx");
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), sub: "other" })).toString("base64url")}.${s}`;
    expectError(await getUser(tampered), "NotAuthorizedException");
    await fetch(`${origin}/__cognito/reset`, { method: "POST" });
    expectError(await getUser(token), "NotAuthorizedException");
    expectError(await cognito("GetUser", { Token: "x" }), "SerializationException");
    expectError(await cognito("GetUser", { AccessToken: 42 }), "SerializationException");
  });

  test("refuses a GetUser that carries an Authorization header (L12: unsigned, token only in the body)", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD, sub: "e2e-employer-0001" });
    const response = await fetch(`${origin}/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.GetUser",
        authorization: "Bearer x",
      },
      body: JSON.stringify({ AccessToken: await accessFor("laura@empresa.mx") }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { __type: string }).__type).toBe("SerializationException");
  });
});

describe("test-only controls", () => {
  test("a one-shot fault answers the next call of that operation, then normal service resumes", async () => {
    await seed({ email: "laura@empresa.mx", password: PASSWORD });
    const set = await control("/fault", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "InitiateAuth", error: "TooManyRequestsException" }) });
    expect(set.status).toBe(200);
    expectError(await signIn("laura@empresa.mx"), "TooManyRequestsException");
    expect((await signIn("laura@empresa.mx")).status).toBe(200);

    await control("/fault", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "SignUp", error: "InternalErrorException" }) });
    expectError(await signUp("x@empresa.mx"), "InternalErrorException", 500);
  });

  test("validates control input", async () => {
    expect((await control("/fault", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "Nope", error: "X" }) })).status).toBe(400);
    expect((await seed({ email: "" })).status).toBe(400);
    expect((await control("/codes")).status).toBe(400);
    expect((await control("/codes?email=ghost%40empresa.mx")).json).toEqual({ confirmation: null, reset: null });
  });

  test("reset clears users and codes", async () => {
    await signUp("laura@empresa.mx");
    await fetch(`${origin}/__cognito/reset`, { method: "POST" });
    expect(await codes("laura@empresa.mx")).toEqual({ confirmation: null, reset: null });
    expect((await signUp("laura@empresa.mx")).status).toBe(200);
  });
});
