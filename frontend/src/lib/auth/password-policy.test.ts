// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PASSWORD_REQUIREMENTS as CLIENT_REQUIREMENTS } from "./cognito/client";
import { MAX_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS, meetsPasswordPolicy, passwordChecks } from "./password-policy";

describe("password policy (one source for the Cognito client and the screens)", () => {
  it("is the list the server-only Cognito client reports on invalid_password", () => {
    expect(CLIENT_REQUIREMENTS).toBe(PASSWORD_REQUIREMENTS);
    expect(PASSWORD_REQUIREMENTS).toEqual(["min_length_8", "lowercase", "uppercase", "number", "symbol"]);
  });

  it("checks each requirement independently", () => {
    expect(passwordChecks("")).toEqual({ min_length_8: false, lowercase: false, uppercase: false, number: false, symbol: false });
    expect(passwordChecks("altavista2026")).toEqual({ min_length_8: true, lowercase: true, uppercase: false, number: true, symbol: false });
    expect(passwordChecks("Altavista#2026")).toEqual({ min_length_8: true, lowercase: true, uppercase: true, number: true, symbol: true });
  });

  it("counts only Cognito's documented symbols, and ASCII letters for the case rules", () => {
    expect(passwordChecks("ñ").symbol).toBe(false);
    expect(passwordChecks("Ñ").uppercase).toBe(false);
    for (const symbol of "^$*.[]{}()?\"!@#%&/\\,><':;|_~`=+-") expect(passwordChecks(symbol).symbol).toBe(true);
  });

  it("accepts a password only when every requirement holds and it fits Cognito's 256 limit", () => {
    expect(meetsPasswordPolicy("Altavista#2026")).toBe(true);
    expect(meetsPasswordPolicy("Altavista2026")).toBe(false);
    expect(meetsPasswordPolicy(`Aa1#${"x".repeat(MAX_PASSWORD_LENGTH - 4)}`)).toBe(true);
    expect(meetsPasswordPolicy(`Aa1#${"x".repeat(MAX_PASSWORD_LENGTH - 3)}`)).toBe(false);
  });
});
