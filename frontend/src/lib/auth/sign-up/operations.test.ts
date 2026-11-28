// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_REQUIREMENTS } from "../password-policy";
import { createAuthAttemptLimiter, type AuthAttemptLimiter } from "../rate-limit";
import { createSignUpOperations } from "./operations";

const PASSWORD = "Altavista#2026";
const CODE = "482913";

function setup(limiter: Pick<AuthAttemptLimiter, "attempt"> = createAuthAttemptLimiter()) {
  const client = {
    signUp: vi.fn().mockResolvedValue({ ok: true, confirmed: false }),
    confirmSignUp: vi.fn().mockResolvedValue({ ok: true }),
    resendCode: vi.fn().mockResolvedValue({ ok: true }),
  };
  const operations = createSignUpOperations({ cognito: () => client, limiter });
  return { client, operations };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

const leaks = (value: unknown) => JSON.stringify(value).match(/Altavista#2026|482913/);

describe("sign-up input validation (no Cognito call when invalid)", () => {
  it.each<[string, unknown, string[]]>([
    ["a non-object", "x", ["name", "email", "password"]],
    ["missing fields", {}, ["name", "email", "password"]],
    ["non-string fields", { name: 1, email: [], password: null }, ["name", "email", "password"]],
    ["a one-character name", { name: " X ", email: "x@correo.com", password: PASSWORD }, ["name"]],
    ["a 121-character name", { name: "a".repeat(121), email: "x@correo.com", password: PASSWORD }, ["name"]],
    ["a control character in the name", { name: "Ana\u0007", email: "x@correo.com", password: PASSWORD }, ["name"]],
    ["an email without a domain", { name: "Ximena Ruiz", email: "ximena@", password: PASSWORD }, ["email"]],
    ["an email with spaces", { name: "Ximena Ruiz", email: "xi mena@correo.com", password: PASSWORD }, ["email"]],
    ["an email over 254 characters", { name: "Ximena Ruiz", email: `${"a".repeat(245)}@correo.com`, password: PASSWORD }, ["email"]],
    ["a weak password", { name: "Ximena Ruiz", email: "x@correo.com", password: "altavista2026" }, ["password"]],
    ["a password over 256 characters", { name: "Ximena Ruiz", email: "x@correo.com", password: `Aa1#${"x".repeat(253)}` }, ["password"]],
  ])("refuses %s", async (_label, input, fields) => {
    expect(await ctx.operations.signUp(input, "203.0.113.7")).toEqual({ ok: false, reason: "invalid_input", fields });
    expect(ctx.client.signUp).not.toHaveBeenCalled();
  });

  it("sends the trimmed email, the password as typed and the normalized name (Cognito requires name, L20)", async () => {
    expect(await ctx.operations.signUp({ name: "  Ximena   Ruiz ", email: " Ximena.Ruiz@Correo.com ", password: PASSWORD }, null)).toEqual({ ok: true, confirmed: false });
    expect(ctx.client.signUp).toHaveBeenCalledExactlyOnceWith("Ximena.Ruiz@Correo.com", PASSWORD, "Ximena Ruiz");
  });

  it("ignores extra fields", async () => {
    await ctx.operations.signUp({ name: "Ximena Ruiz", email: "x@correo.com", password: PASSWORD, role: "recruiter" }, null);
    expect(ctx.client.signUp).toHaveBeenCalledExactlyOnceWith("x@correo.com", PASSWORD, "Ximena Ruiz");
  });
});

describe("confirm and resend input validation", () => {
  it.each(["", "48291", "4829134", "48291a", "４８２９１３", " 482913", null, 482913])("refuses the code %j", async (code) => {
    expect(await ctx.operations.confirmSignUp({ email: "x@correo.com", code }, null)).toEqual({ ok: false, reason: "invalid_input" });
    expect(ctx.client.confirmSignUp).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "nope", 7])("refuses the email %j", async (email) => {
    expect(await ctx.operations.confirmSignUp({ email, code: CODE }, null)).toEqual({ ok: false, reason: "invalid_input" });
    expect(await ctx.operations.resendCode({ email }, null)).toEqual({ ok: false, reason: "invalid_input" });
    expect(ctx.client.confirmSignUp).not.toHaveBeenCalled();
    expect(ctx.client.resendCode).not.toHaveBeenCalled();
  });

  it("confirms with exactly six ASCII digits and resends to the trimmed email", async () => {
    expect(await ctx.operations.confirmSignUp({ email: " x@correo.com", code: CODE }, null)).toEqual({ ok: true });
    expect(ctx.client.confirmSignUp).toHaveBeenCalledExactlyOnceWith("x@correo.com", CODE);
    expect(await ctx.operations.resendCode({ email: "x@correo.com " }, null)).toEqual({ ok: true });
    expect(ctx.client.resendCode).toHaveBeenCalledExactlyOnceWith("x@correo.com");
  });
});

describe("rate limiting per IP and per normalized email, before Cognito", () => {
  it("passes the operation, the client address and the email to the shared limiter", async () => {
    const attempt = vi.fn().mockReturnValue({ ok: true });
    const { operations } = setup({ attempt });
    await operations.signUp({ name: "Ximena Ruiz", email: "X@Correo.com", password: PASSWORD }, "203.0.113.7");
    await operations.confirmSignUp({ email: "x@correo.com", code: CODE }, "203.0.113.7");
    await operations.resendCode({ email: "x@correo.com" }, null);
    expect(attempt.mock.calls).toEqual([
      ["signUp", { ip: "203.0.113.7", email: "X@Correo.com" }],
      ["confirmSignUp", { ip: "203.0.113.7", email: "x@correo.com" }],
      // No derivable address: only the per-email budget applies (rate-limit.ts).
      ["resendCode", { email: "x@correo.com" }],
    ]);
  });

  it("does not spend budget on invalid input", async () => {
    const attempt = vi.fn().mockReturnValue({ ok: true });
    const { operations } = setup({ attempt });
    await operations.signUp({ name: "", email: "x@correo.com", password: PASSWORD }, "203.0.113.7");
    expect(attempt).not.toHaveBeenCalled();
  });

  it("answers too_many_attempts without calling Cognito once the per-email budget is spent (any case, any address)", async () => {
    for (let index = 0; index < 3; index += 1) {
      expect(await ctx.operations.resendCode({ email: "x@correo.com" }, `203.0.113.${index}`)).toEqual({ ok: true });
    }
    expect(await ctx.operations.resendCode({ email: " X@CORREO.com" }, "198.51.100.1")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.resendCode).toHaveBeenCalledTimes(3);
  });

  it("answers too_many_attempts without calling Cognito once the per-IP budget is spent", async () => {
    for (let index = 0; index < 10; index += 1) {
      await ctx.operations.signUp({ name: "Ximena Ruiz", email: `x${index}@correo.com`, password: PASSWORD }, "203.0.113.7");
    }
    expect(await ctx.operations.signUp({ name: "Ximena Ruiz", email: "new@correo.com", password: PASSWORD }, "203.0.113.7")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.signUp).toHaveBeenCalledTimes(10);
  });

  it("limits confirmations per email so codes cannot be guessed past the budget", async () => {
    ctx.client.confirmSignUp.mockResolvedValue({ ok: false, reason: "code_mismatch" });
    for (let index = 0; index < 10; index += 1) await ctx.operations.confirmSignUp({ email: "x@correo.com", code: CODE }, `203.0.113.${index}`);
    expect(await ctx.operations.confirmSignUp({ email: "x@correo.com", code: CODE }, "198.51.100.1")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.confirmSignUp).toHaveBeenCalledTimes(10);
  });
});

describe("outcome mapping to closed reasons", () => {
  const signUpInput = { name: "Ximena Ruiz", email: "x@correo.com", password: PASSWORD };

  it.each<[unknown, unknown]>([
    [{ ok: true, confirmed: true }, { ok: true, confirmed: true }],
    [{ ok: false, reason: "email_taken" }, { ok: false, reason: "email_taken" }],
    [{ ok: false, reason: "invalid_password", requirements: PASSWORD_REQUIREMENTS }, { ok: false, reason: "invalid_password" }],
    [{ ok: false, reason: "too_many_attempts" }, { ok: false, reason: "too_many_attempts" }],
    [{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "code_mismatch" }, { ok: false, reason: "unavailable" }],
  ])("sign-up %j → %j", async (cognito, expected) => {
    ctx.client.signUp.mockResolvedValue(cognito);
    expect(await ctx.operations.signUp(signUpInput, null)).toEqual(expected);
  });

  it.each<[unknown, unknown]>([
    [{ ok: false, reason: "code_mismatch" }, { ok: false, reason: "code_mismatch" }],
    [{ ok: false, reason: "code_expired" }, { ok: false, reason: "code_expired" }],
    [{ ok: false, reason: "too_many_attempts" }, { ok: false, reason: "too_many_attempts" }],
    [{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "email_taken" }, { ok: false, reason: "unavailable" }],
  ])("confirm %j → %j", async (cognito, expected) => {
    ctx.client.confirmSignUp.mockResolvedValue(cognito);
    expect(await ctx.operations.confirmSignUp({ email: "x@correo.com", code: CODE }, null)).toEqual(expected);
  });

  it.each<[unknown, unknown]>([
    [{ ok: false, reason: "too_many_attempts" }, { ok: false, reason: "too_many_attempts" }],
    [{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "code_mismatch" }, { ok: false, reason: "unavailable" }],
  ])("resend %j → %j", async (cognito, expected) => {
    ctx.client.resendCode.mockResolvedValue(cognito);
    expect(await ctx.operations.resendCode({ email: "x@correo.com" }, null)).toEqual(expected);
  });

  it("answers unavailable when the client cannot be built or throws, without echoing anything", async () => {
    const broken = createSignUpOperations({ cognito: () => { throw new Error(`config ${PASSWORD}`); }, limiter: createAuthAttemptLimiter() });
    const result = await broken.signUp(signUpInput, null);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    ctx.client.confirmSignUp.mockRejectedValue(new Error(`boom ${CODE}`));
    const confirmed = await ctx.operations.confirmSignUp({ email: "x@correo.com", code: CODE }, null);
    expect(confirmed).toEqual({ ok: false, reason: "unavailable" });
    expect(leaks([result, confirmed])).toBeNull();
  });

  it("never returns the password or the code", async () => {
    const results = [
      await ctx.operations.signUp(signUpInput, null),
      await ctx.operations.signUp({ ...signUpInput, name: "" }, null),
      await ctx.operations.confirmSignUp({ email: "x@correo.com", code: CODE }, null),
      await ctx.operations.confirmSignUp({ email: "bad", code: CODE }, null),
    ];
    expect(leaks(results)).toBeNull();
  });
});
