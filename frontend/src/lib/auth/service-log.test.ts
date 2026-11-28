// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { COGNITO_SERVICE_ERROR_PREFIX, createCognitoServiceErrorLogger, formatCognitoServiceError } from "./service-log";

describe("Cognito operator log line", () => {
  it("is one line with a fixed prefix, the operation and the error name only", () => {
    expect(formatCognitoServiceError("signIn", "SecretHashMismatch")).toBe(
      `${COGNITO_SERVICE_ERROR_PREFIX} operation=signIn name=SecretHashMismatch`,
    );
    expect(COGNITO_SERVICE_ERROR_PREFIX).toBe("[auth] cognito_service_error");
  });

  it("writes `none` for a nameless failure (network, timeout, malformed answer)", () => {
    expect(formatCognitoServiceError("refresh", null)).toBe(`${COGNITO_SERVICE_ERROR_PREFIX} operation=refresh name=none`);
  });

  it.each([
    ["an unknown operation", "dropTables", "InternalErrorException", "operation=unknown name=InternalErrorException"],
    ["a name with spaces", "signIn", "Unable to verify secret hash for client abc", "operation=signIn name=invalid"],
    ["a token-looking name", "signIn", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln", "operation=signIn name=invalid"],
    ["an email", "forgotPassword", "laura@empresa.mx", "operation=forgotPassword name=invalid"],
    ["a newline injection", "signUp", "Name\noperation=fake", "operation=signUp name=invalid"],
  ])("never echoes %s", (_label, operation, name, expected) => {
    const line = formatCognitoServiceError(operation, name);
    expect(line).toBe(`${COGNITO_SERVICE_ERROR_PREFIX} ${expected}`);
    expect(line).not.toContain("\n");
  });

  it("logs through the injected sink exactly once per signal and never throws", () => {
    const sink = vi.fn();
    const log = createCognitoServiceErrorLogger(sink);
    log("signIn", "SecretHashMismatch");
    expect(sink).toHaveBeenCalledExactlyOnceWith(`${COGNITO_SERVICE_ERROR_PREFIX} operation=signIn name=SecretHashMismatch`);
    const broken = createCognitoServiceErrorLogger(() => {
      throw new Error("sink broke");
    });
    expect(() => broken("refresh", null)).not.toThrow();
  });

  it("defaults to a single console.warn line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createCognitoServiceErrorLogger()("signUp", "InternalErrorException");
    expect(warn).toHaveBeenCalledExactlyOnceWith(`${COGNITO_SERVICE_ERROR_PREFIX} operation=signUp name=InternalErrorException`);
    warn.mockRestore();
  });
});
