// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  headers: vi.fn(),
  client: { signUp: vi.fn(), confirmSignUp: vi.fn(), resendCode: vi.fn() },
}));
vi.mock("next/headers", () => ({ headers: deps.headers }));
vi.mock("../cognito-shared", () => ({ sharedCognitoClient: () => deps.client }));

import { confirmSignUpAction, resendCodeAction, signUpAction } from "./actions";

const PASSWORD = "Altavista#2026";

beforeEach(() => {
  vi.clearAllMocks();
  deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.50" }));
  deps.client.signUp.mockResolvedValue({ ok: true, confirmed: false });
  deps.client.confirmSignUp.mockResolvedValue({ ok: true });
  deps.client.resendCode.mockResolvedValue({ ok: true });
});

describe("sign-up server actions", () => {
  it("is a Server Actions module (Next checks Origin against Host on every action POST)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/auth/sign-up/actions.ts"), "utf8");
    expect(source.trimStart().startsWith('"use server";')).toBe(true);
  });

  it("calls the shared Cognito client through validation", async () => {
    expect(await signUpAction({ name: "Ximena Ruiz", email: "a@correo.com", password: PASSWORD })).toEqual({ ok: true, confirmed: false });
    expect(await confirmSignUpAction({ email: "a@correo.com", code: "482913" })).toEqual({ ok: true });
    expect(await resendCodeAction({ email: "a@correo.com" })).toEqual({ ok: true });
    expect(deps.client.signUp).toHaveBeenCalledExactlyOnceWith("a@correo.com", PASSWORD, "Ximena Ruiz");
  });

  it("limits per client address derived like the route guard (right-most X-Forwarded-For hop)", async () => {
    // The per-IP resend budget is 10 per window; distinct emails keep the per-email budget out of the way.
    // The limiter lives for the module, so this test uses an address no other test uses.
    deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.50, 203.0.113.60" }));
    for (let index = 0; index < 10; index += 1) expect(await resendCodeAction({ email: `ip${index}@correo.com` })).toEqual({ ok: true });
    expect(await resendCodeAction({ email: "ip-last@correo.com" })).toEqual({ ok: false, reason: "too_many_attempts" });
    // Another proxy-observed address has its own budget, whatever the client-supplied left part says.
    deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.60, 203.0.113.61" }));
    expect(await resendCodeAction({ email: "ip-other@correo.com" })).toEqual({ ok: true });
    expect(deps.client.resendCode).toHaveBeenCalledTimes(11);
  });

  it("answers unavailable when the request headers cannot be read or anything throws", async () => {
    deps.headers.mockRejectedValue(new Error("outside a request"));
    deps.client.confirmSignUp.mockRejectedValue(new Error("boom 482913"));
    const result = await confirmSignUpAction({ email: "h@correo.com", code: "482913" });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns only closed results: no password, code or Cognito detail", async () => {
    deps.client.signUp.mockResolvedValue({ ok: false, reason: "invalid_password", requirements: ["min_length_8"] });
    const results = [
      await signUpAction({ name: "Ximena Ruiz", email: "r@correo.com", password: PASSWORD }),
      await confirmSignUpAction({ email: "r@correo.com", code: "000000" }),
    ];
    expect(results[0]).toEqual({ ok: false, reason: "invalid_password" });
    expect(JSON.stringify(results)).not.toMatch(/Altavista#2026|000000|requirements/);
  });
});
