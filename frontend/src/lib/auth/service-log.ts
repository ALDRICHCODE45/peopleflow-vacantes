import "server-only";
import type { CognitoClientOperation } from "./cognito/client";

/** Fixed prefix operators can alert on (e.g. a wrong client secret: name=SecretHashMismatch). */
export const COGNITO_SERVICE_ERROR_PREFIX = "[auth] cognito_service_error";

const OPERATIONS: ReadonlySet<string> = new Set<CognitoClientOperation>([
  "signIn",
  "refresh",
  "signUp",
  "confirmSignUp",
  "resendCode",
  "forgotPassword",
  "confirmForgotPassword",
]);
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,99}$/;

export type CognitoServiceErrorLog = (operation: CognitoClientOperation, errorName: string | null) => void;

/**
 * One token-free line: the fixed prefix, the operation and the sanitized error
 * name. Values outside the closed operation set or the error-name alphabet are
 * replaced, so no email, password, code, token or Cognito message can reach it.
 */
export function formatCognitoServiceError(operation: string, errorName: string | null): string {
  const op = OPERATIONS.has(operation) ? operation : "unknown";
  const name = errorName === null ? "none" : ERROR_NAME.test(errorName) ? errorName : "invalid";
  return `${COGNITO_SERVICE_ERROR_PREFIX} operation=${op} name=${name}`;
}

/** The Cognito client's `onServiceError` hook; a failing sink never changes an auth outcome. */
export function createCognitoServiceErrorLogger(
  log: (line: string) => void = (line) => console.warn(line),
): CognitoServiceErrorLog {
  return (operation, errorName) => {
    try {
      log(formatCognitoServiceError(operation, errorName));
    } catch {
      // Logging must never alter authentication.
    }
  };
}
