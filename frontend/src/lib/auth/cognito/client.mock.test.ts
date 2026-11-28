// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCognitoClient, type CognitoClient } from "./client";
import { COGNITO_IDP_ENDPOINT_KEY, resolveCognitoEndpoint } from "./config";
import { createForgotPasswordOperations } from "../forgot-password/operations";
import { createAuthAttemptLimiter } from "../rate-limit";

// The real client against tests/fixtures/cognito-mock.mjs (defaults: peopleflow-e2e / peopleflow-e2e-secret).
let server: ChildProcess;
let origin: string;
let client: CognitoClient;
const PASSWORD = "Sup3r-secret-pass!";

beforeAll(async () => {
  server = spawn(process.execPath, ["tests/fixtures/cognito-mock.mjs"], {
    env: { ...process.env, COGNITO_MOCK_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [chunk] = await once(server.stdout!, "data");
  origin = `http://127.0.0.1:${String(chunk).match(/cognito mock listening on (\d+)/)![1]}`;
  client = createCognitoClient({
    endpoint: resolveCognitoEndpoint("https://e2e.peopleflow.test/identity", {
      NODE_ENV: "test",
      [COGNITO_IDP_ENDPOINT_KEY]: origin,
    }),
    clientId: "peopleflow-e2e",
    clientSecret: "peopleflow-e2e-secret",
  });
});
afterAll(async () => {
  const closed = once(server, "exit");
  server.kill("SIGTERM");
  await closed;
});
beforeEach(async () => {
  await fetch(`${origin}/__cognito/reset`, { method: "POST" });
});

const codes = async (email: string) =>
  (await (await fetch(`${origin}/__cognito/codes?email=${encodeURIComponent(email)}`)).json()) as {
    confirmation: string | null;
    reset: string | null;
  };
const sub = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub as string;

describe("Cognito client ↔ mock Cognito", () => {
  it("signs up, confirms with the code, signs in and refreshes with the sub", async () => {
    expect(await client.signUp("laura@empresa.mx", PASSWORD, "Laura")).toEqual({ ok: true, confirmed: false });
    expect(await client.signUp("laura@empresa.mx", PASSWORD, "Laura")).toEqual({ ok: false, reason: "email_taken" });
    expect(await client.signIn("laura@empresa.mx", PASSWORD)).toEqual({ ok: false, reason: "not_confirmed" });
    expect(await client.resendCode("laura@empresa.mx")).toEqual({ ok: true });
    const { confirmation } = await codes("laura@empresa.mx");
    expect(await client.confirmSignUp("laura@empresa.mx", confirmation === "000000" ? "111111" : "000000")).toEqual({
      ok: false,
      reason: "code_mismatch",
    });
    expect(await client.confirmSignUp("laura@empresa.mx", String(confirmation))).toEqual({ ok: true });

    const signedIn = await client.signIn("laura@empresa.mx", PASSWORD);
    if (!signedIn.ok || signedIn.kind !== "tokens") throw new Error("expected tokens");
    const refreshed = await client.refresh(signedIn.tokens.refreshToken, sub(signedIn.tokens.accessToken));
    expect(refreshed).toMatchObject({ ok: true, tokens: { refreshToken: signedIn.tokens.refreshToken } });
    // A SECRET_HASH over the wrong username is Cognito's secret-hash rejection: a
    // configuration failure since A4.2 (L14), not a user error. Either way the session expires.
    expect(await client.refresh(signedIn.tokens.refreshToken, "not-the-sub")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("normalizes the email before the (case-sensitive) mock sees it", async () => {
    expect(await client.signUp(" Ana@X.mx ", PASSWORD, "Ana")).toEqual({ ok: true, confirmed: false });
    expect(await client.signUp("ana@x.mx", PASSWORD, "Ana")).toEqual({ ok: false, reason: "email_taken" });
    const { confirmation } = await codes("ana@x.mx");
    expect(await codes("Ana@X.mx")).toEqual({ confirmation: null, reset: null });
    expect(await client.confirmSignUp("ANA@x.MX", String(confirmation))).toEqual({ ok: true });
    expect(await client.signIn("  ana@X.MX", PASSWORD)).toMatchObject({ ok: true, kind: "tokens" });
  });

  it("hides whether an account exists on sign-in, resend, forgot and confirm", async () => {
    await client.signUp("laura@empresa.mx", PASSWORD, "Laura");
    expect(await client.signIn("ghost@empresa.mx", PASSWORD)).toEqual({ ok: false, reason: "invalid_credentials" });
    // Wrong password on an unconfirmed account does not reveal the unconfirmed state.
    expect(await client.signIn("laura@empresa.mx", "Wr0ng-password!")).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await client.resendCode("ghost@empresa.mx")).toEqual({ ok: true });
    expect(await client.forgotPassword("ghost@empresa.mx")).toEqual({ ok: true });
    expect(await client.confirmSignUp("ghost@empresa.mx", "123456")).toEqual({ ok: false, reason: "code_mismatch" });
    expect(await client.confirmForgotPassword("ghost@empresa.mx", "123456", PASSWORD)).toEqual({
      ok: false,
      reason: "code_mismatch",
    });
  });

  it("forgot password on an unconfirmed account: no code, the same silent ok as an unknown email (L14 advisory 2)", async () => {
    const signals: [string, string | null][] = [];
    const observed = createCognitoClient({
      endpoint: resolveCognitoEndpoint("https://e2e.peopleflow.test/identity", { NODE_ENV: "test", [COGNITO_IDP_ENDPOINT_KEY]: origin }),
      clientId: "peopleflow-e2e",
      clientSecret: "peopleflow-e2e-secret",
      onServiceError: (operation, name) => signals.push([operation, name]),
    });
    // The server action path end to end: validation → limiter → real client → mock Cognito.
    const operations = createForgotPasswordOperations({ cognito: () => observed, limiter: createAuthAttemptLimiter() });
    await observed.signUp("laura@empresa.mx", PASSWORD, "Laura");
    const unconfirmed = await operations.forgotPassword({ email: " Laura@Empresa.mx " }, "203.0.113.7");
    const unknown = await operations.forgotPassword({ email: "ghost@empresa.mx" }, "203.0.113.7");
    expect(unconfirmed).toEqual({ ok: true });
    expect(unconfirmed).toEqual(unknown);
    expect((await codes("laura@empresa.mx")).reset).toBeNull();
    // The operator learns why no code went out (value-free), the person does not.
    expect(signals).toEqual([["forgotPassword", "InvalidParameterException"]]);
    // Without a code, a guess is just a wrong code.
    expect(await operations.confirmForgotPassword({ email: "laura@empresa.mx", code: "123456", newPassword: "N3w-secret-pass!" }, "203.0.113.7")).toEqual({
      ok: false,
      reason: "code_mismatch",
    });
  });

  it("resets a password with the emailed code and maps policy and throttling", async () => {
    await fetch(`${origin}/__cognito/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "laura@empresa.mx", password: PASSWORD }),
    });
    expect(await client.forgotPassword("laura@empresa.mx")).toEqual({ ok: true });
    const { reset } = await codes("laura@empresa.mx");
    expect(await client.confirmForgotPassword("laura@empresa.mx", String(reset), "weak")).toMatchObject({
      ok: false,
      reason: "invalid_password",
    });
    expect(await client.confirmForgotPassword("laura@empresa.mx", String(reset), "N3w-secret-pass!")).toEqual({ ok: true });
    expect(await client.signIn("laura@empresa.mx", "N3w-secret-pass!")).toMatchObject({ ok: true, kind: "tokens" });

    await fetch(`${origin}/__cognito/fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "InitiateAuth", error: "TooManyRequestsException" }),
    });
    expect(await client.signIn("laura@empresa.mx", "N3w-secret-pass!")).toEqual({ ok: false, reason: "too_many_attempts" });
    await fetch(`${origin}/__cognito/fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "SignUp", error: "InternalErrorException" }),
    });
    expect(await client.signUp("x@empresa.mx", PASSWORD, "X")).toEqual({ ok: false, reason: "unavailable" });
  });
});
