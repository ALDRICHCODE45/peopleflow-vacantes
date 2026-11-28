// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD_REQUIREMENTS } from "../password-policy";
import { createAuthAttemptLimiter, type AuthAttemptLimiter } from "../rate-limit";
import { createForgotPasswordOperations } from "./operations";

const PASSWORD = "Altavista#2026";
const CODE = "482913";

function setup(limiter: Pick<AuthAttemptLimiter, "attempt"> = createAuthAttemptLimiter()) {
  const client = {
    forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
    confirmForgotPassword: vi.fn().mockResolvedValue({ ok: true }),
  };
  const operations = createForgotPasswordOperations({ cognito: () => client, limiter });
  return { client, operations };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => { ctx = setup(); });

const leaks = (value: unknown) => JSON.stringify(value).match(/Altavista#2026|482913/);
const confirmInput = (overrides: Record<string, unknown> = {}) => ({ email: "x@correo.com", code: CODE, newPassword: PASSWORD, ...overrides });

describe("forgot password: input validation (no limiter, no Cognito when invalid)", () => {
  it.each([undefined, "", "nope", "a@b", 7, ["x@correo.com"], `${"a".repeat(245)}@correo.com`, "xi mena@correo.com"])("refuses the email %j", async (email) => {
    const attempt = vi.fn().mockReturnValue({ ok: true });
    const { operations, client } = setup({ attempt });
    expect(await operations.forgotPassword({ email }, "203.0.113.7")).toEqual({ ok: false, reason: "invalid_input" });
    expect(attempt).not.toHaveBeenCalled();
    expect(client.forgotPassword).not.toHaveBeenCalled();
  });

  it("refuses a non-object input", async () => {
    expect(await ctx.operations.forgotPassword("x@correo.com", null)).toEqual({ ok: false, reason: "invalid_input" });
    expect(ctx.client.forgotPassword).not.toHaveBeenCalled();
  });

  it("sends the trimmed email and ignores extra fields", async () => {
    expect(await ctx.operations.forgotPassword({ email: " Laura@Empresa.mx ", role: "recruiter" }, null)).toEqual({ ok: true });
    expect(ctx.client.forgotPassword).toHaveBeenCalledExactlyOnceWith("Laura@Empresa.mx");
  });
});

describe("confirm forgot password: input validation (no limiter, no Cognito when invalid)", () => {
  it.each<[string, unknown, string[]]>([
    ["a non-object", "x", ["email", "code", "password"]],
    ["missing fields", {}, ["email", "code", "password"]],
    ["non-string fields", { email: 1, code: 482913, newPassword: null }, ["email", "code", "password"]],
    ["an invalid email", confirmInput({ email: "x@" }), ["email"]],
    ["a five-digit code", confirmInput({ code: "48291" }), ["code"]],
    ["a code with spaces", confirmInput({ code: " 482913" }), ["code"]],
    ["full-width digits", confirmInput({ code: "４８２９１３" }), ["code"]],
    ["a weak password", confirmInput({ newPassword: "altavista2026" }), ["password"]],
    ["a password over 256 characters", confirmInput({ newPassword: `Aa1#${"x".repeat(253)}` }), ["password"]],
    ["the password under another key", { email: "x@correo.com", code: CODE, password: PASSWORD }, ["password"]],
  ])("refuses %s", async (_label, input, fields) => {
    const attempt = vi.fn().mockReturnValue({ ok: true });
    const { operations, client } = setup({ attempt });
    expect(await operations.confirmForgotPassword(input, "203.0.113.7")).toEqual({ ok: false, reason: "invalid_input", fields });
    expect(attempt).not.toHaveBeenCalled();
    expect(client.confirmForgotPassword).not.toHaveBeenCalled();
  });

  it("sends the trimmed email, the code and the new password as typed", async () => {
    expect(await ctx.operations.confirmForgotPassword(confirmInput({ email: " x@correo.com " }), null)).toEqual({ ok: true });
    expect(ctx.client.confirmForgotPassword).toHaveBeenCalledExactlyOnceWith("x@correo.com", CODE, PASSWORD);
  });
});

describe("rate limiting per IP and per normalized email, before Cognito", () => {
  it("passes the operation, the client address and the email to the shared limiter", async () => {
    const attempt = vi.fn().mockReturnValue({ ok: true });
    const { operations } = setup({ attempt });
    await operations.forgotPassword({ email: "X@Correo.com" }, "203.0.113.7");
    await operations.confirmForgotPassword(confirmInput(), "203.0.113.7");
    await operations.forgotPassword({ email: "x@correo.com" }, null);
    expect(attempt.mock.calls).toEqual([
      ["forgotPassword", { ip: "203.0.113.7", email: "X@Correo.com" }],
      ["confirmForgotPassword", { ip: "203.0.113.7", email: "x@correo.com" }],
      // No derivable address: only the per-email budget applies (rate-limit.ts).
      ["forgotPassword", { email: "x@correo.com" }],
    ]);
  });

  it("answers too_many_attempts without calling Cognito once the per-email code budget is spent (any case, any address)", async () => {
    for (let index = 0; index < 3; index += 1) {
      expect(await ctx.operations.forgotPassword({ email: "x@correo.com" }, `203.0.113.${index}`)).toEqual({ ok: true });
    }
    expect(await ctx.operations.forgotPassword({ email: " X@CORREO.com" }, "198.51.100.1")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.forgotPassword).toHaveBeenCalledTimes(3);
  });

  it("answers too_many_attempts without calling Cognito once the per-IP budget is spent", async () => {
    for (let index = 0; index < 10; index += 1) await ctx.operations.forgotPassword({ email: `x${index}@correo.com` }, "203.0.113.7");
    expect(await ctx.operations.forgotPassword({ email: "new@correo.com" }, "203.0.113.7")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.forgotPassword).toHaveBeenCalledTimes(10);
  });

  it("limits reset confirmations per email so codes cannot be guessed past the budget", async () => {
    ctx.client.confirmForgotPassword.mockResolvedValue({ ok: false, reason: "code_mismatch" });
    for (let index = 0; index < 10; index += 1) await ctx.operations.confirmForgotPassword(confirmInput(), `203.0.113.${index}`);
    expect(await ctx.operations.confirmForgotPassword(confirmInput(), "198.51.100.1")).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(ctx.client.confirmForgotPassword).toHaveBeenCalledTimes(10);
  });

  it("keeps the request and confirm budgets apart (a spent request budget does not block the code)", async () => {
    for (let index = 0; index < 3; index += 1) await ctx.operations.forgotPassword({ email: "x@correo.com" }, null);
    expect(await ctx.operations.forgotPassword({ email: "x@correo.com" }, null)).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(await ctx.operations.confirmForgotPassword(confirmInput(), null)).toEqual({ ok: true });
  });
});

describe("outcome mapping to closed reasons", () => {
  it.each<[unknown, unknown]>([
    // The client already turns unknown / unconfirmed / unverified accounts into this silent ok.
    [{ ok: true }, { ok: true }],
    [{ ok: false, reason: "too_many_attempts" }, { ok: false, reason: "too_many_attempts" }],
    [{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "code_mismatch" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "invalid_credentials" }, { ok: false, reason: "unavailable" }],
  ])("forgot %j → %j", async (cognito, expected) => {
    ctx.client.forgotPassword.mockResolvedValue(cognito);
    expect(await ctx.operations.forgotPassword({ email: "x@correo.com" }, null)).toEqual(expected);
  });

  it.each<[unknown, unknown]>([
    [{ ok: false, reason: "code_mismatch" }, { ok: false, reason: "code_mismatch" }],
    [{ ok: false, reason: "code_expired" }, { ok: false, reason: "code_expired" }],
    [{ ok: false, reason: "invalid_password", requirements: PASSWORD_REQUIREMENTS }, { ok: false, reason: "invalid_password" }],
    [{ ok: false, reason: "too_many_attempts" }, { ok: false, reason: "too_many_attempts" }],
    [{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "email_taken" }, { ok: false, reason: "unavailable" }],
    [{ ok: false, reason: "not_confirmed" }, { ok: false, reason: "unavailable" }],
  ])("confirm %j → %j", async (cognito, expected) => {
    ctx.client.confirmForgotPassword.mockResolvedValue(cognito);
    expect(await ctx.operations.confirmForgotPassword(confirmInput(), null)).toEqual(expected);
  });

  it("answers unavailable when the client cannot be built or throws, without echoing anything", async () => {
    const broken = createForgotPasswordOperations({ cognito: () => { throw new Error(`config ${PASSWORD}`); }, limiter: createAuthAttemptLimiter() });
    const results = [
      await broken.forgotPassword({ email: "x@correo.com" }, null),
      await broken.confirmForgotPassword(confirmInput(), null),
    ];
    ctx.client.confirmForgotPassword.mockRejectedValue(new Error(`boom ${CODE} ${PASSWORD}`));
    results.push(await ctx.operations.confirmForgotPassword(confirmInput(), null));
    expect(results).toEqual([{ ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }, { ok: false, reason: "unavailable" }]);
    expect(leaks(results)).toBeNull();
  });

  it("never returns the password or the code", async () => {
    ctx.client.confirmForgotPassword.mockResolvedValue({ ok: false, reason: "invalid_password", requirements: PASSWORD_REQUIREMENTS });
    const results = [
      await ctx.operations.confirmForgotPassword(confirmInput(), null),
      await ctx.operations.confirmForgotPassword(confirmInput({ email: "bad" }), null),
      await ctx.operations.confirmForgotPassword(confirmInput({ newPassword: "weak", code: CODE }), null),
    ];
    expect(leaks(results)).toBeNull();
    expect(JSON.stringify(results)).not.toMatch(/requirements/);
  });

  it("does not log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    ctx.client.confirmForgotPassword.mockRejectedValue(new Error("boom"));
    await ctx.operations.forgotPassword({ email: "x@correo.com" }, null);
    await ctx.operations.confirmForgotPassword(confirmInput(), null);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
