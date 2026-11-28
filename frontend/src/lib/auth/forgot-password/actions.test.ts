// @vitest-environment node
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  headers: vi.fn(),
  client: { forgotPassword: vi.fn(), confirmForgotPassword: vi.fn() },
}));
vi.mock("next/headers", () => ({ headers: deps.headers }));
vi.mock("../cognito-shared", () => ({ sharedCognitoClient: () => deps.client }));

import { confirmForgotPasswordAction, forgotPasswordAction } from "./actions";

const PASSWORD = "Altavista#2026";

beforeEach(() => {
  vi.clearAllMocks();
  deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.50" }));
  deps.client.forgotPassword.mockResolvedValue({ ok: true });
  deps.client.confirmForgotPassword.mockResolvedValue({ ok: true });
});

describe("forgot-password server actions", () => {
  it("is a Server Actions module (Next checks Origin against Host on every action POST)", () => {
    // Run from elsewhere on purpose: the module is located from this file, not the cwd.
    const cwd = process.cwd();
    process.chdir(tmpdir());
    let source: string;
    try {
      source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    } finally {
      process.chdir(cwd);
    }
    expect(source.trimStart().startsWith('"use server";')).toBe(true);
  });

  it("calls the shared Cognito client through validation", async () => {
    expect(await forgotPasswordAction({ email: "a@correo.com" })).toEqual({ ok: true });
    expect(await confirmForgotPasswordAction({ email: "a@correo.com", code: "482913", newPassword: PASSWORD })).toEqual({ ok: true });
    expect(deps.client.forgotPassword).toHaveBeenCalledExactlyOnceWith("a@correo.com");
    expect(deps.client.confirmForgotPassword).toHaveBeenCalledExactlyOnceWith("a@correo.com", "482913", PASSWORD);
  });

  it("limits per client address derived like the route guard (right-most X-Forwarded-For hop)", async () => {
    // The per-IP forgot budget is 10 per window; distinct emails keep the per-email budget out of the way.
    deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.70, 203.0.113.80" }));
    for (let index = 0; index < 10; index += 1) expect(await forgotPasswordAction({ email: `ip${index}@correo.com` })).toEqual({ ok: true });
    expect(await forgotPasswordAction({ email: "ip-last@correo.com" })).toEqual({ ok: false, reason: "too_many_attempts" });
    // Another proxy-observed address has its own budget, whatever the client-supplied left part says.
    deps.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.80, 203.0.113.81" }));
    expect(await forgotPasswordAction({ email: "ip-other@correo.com" })).toEqual({ ok: true });
    expect(deps.client.forgotPassword).toHaveBeenCalledTimes(11);
  });

  it("answers unavailable when the request headers cannot be read or anything throws", async () => {
    deps.headers.mockRejectedValue(new Error("outside a request"));
    expect(await forgotPasswordAction({ email: "h@correo.com" })).toEqual({ ok: false, reason: "unavailable" });
    expect(await confirmForgotPasswordAction({ email: "h@correo.com", code: "482913", newPassword: PASSWORD })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns only closed results: no password, code or Cognito detail", async () => {
    deps.client.confirmForgotPassword.mockResolvedValue({ ok: false, reason: "invalid_password", requirements: ["min_length_8"] });
    const results = [
      await confirmForgotPasswordAction({ email: "r@correo.com", code: "000000", newPassword: PASSWORD }),
      await confirmForgotPasswordAction({ email: "r@correo.com", code: "00000", newPassword: PASSWORD }),
    ];
    expect(results[0]).toEqual({ ok: false, reason: "invalid_password" });
    expect(results[1]).toEqual({ ok: false, reason: "invalid_input", fields: ["code"] });
    expect(JSON.stringify(results)).not.toMatch(/Altavista#2026|000000|requirements/);
  });
});
