import { describe, expect, it } from "vitest";
import { classifySignInResult } from "./outcome";

describe("classifySignInResult (NextAuth signIn result → screen outcome)", () => {
  it("is a success only for an ok result with no error and a non-auth URL", () => {
    expect(classifySignInResult({ ok: true, error: null, status: 200, url: "http://localhost:3000/empresa/dashboard" })).toBe("success");
  });

  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["too_many_attempts", "too_many_attempts"],
    ["not_confirmed", "not_confirmed"],
    ["unavailable", "unavailable"],
    ["CredentialsSignin", "unavailable"],
    ["something-new", "unavailable"],
  ])("maps the error code %s to %s", (error, outcome) => {
    expect(classifySignInResult({ ok: false, error, status: 401, url: null })).toBe(outcome);
  });

  it.each([
    ["no result", undefined],
    ["a CSRF bounce to the NextAuth sign-in page", { ok: true, error: null, status: 200, url: "http://localhost:3000/api/auth/signin?csrf=true" }],
    ["an ok result without URL", { ok: true, error: null, status: 200, url: null }],
    ["a non-ok result without code", { ok: false, error: null, status: 500, url: null }],
  ])("treats %s as unavailable", (_label, result) => {
    expect(classifySignInResult(result as never)).toBe("unavailable");
  });
});
