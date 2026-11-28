import "server-only";

/**
 * Closed set of reasons the embedded auth may act on. None of them reveals
 * whether an account exists, with one documented exception: `email_taken`.
 *
 * `email_taken` (UsernameExistsException) is returned only to the sign-up
 * caller. Cognito itself answers it on SignUp even with
 * PreventUserExistenceErrors=ENABLED, and hiding it would leave a person who
 * already has an account stuck on a code screen that never receives a code.
 * The trade-off: sign-up can be used to probe whether an email is registered.
 * Mitigation: the sign-up route must be rate limited per client and per email
 * (A4.3) and its copy must not distinguish more than "this email cannot be used
 * to create an account; sign in or reset your password". Every other operation
 * maps unknown-user and wrong-state errors onto the same answer a wrong
 * password/code gets, or onto a silent success.
 */
export type CognitoFailureReason =
  | "invalid_credentials"
  | "not_confirmed"
  | "code_mismatch"
  | "code_expired"
  | "too_many_attempts"
  | "invalid_password"
  | "email_taken"
  | "unavailable";

export type CognitoClientOperation =
  | "signIn"
  | "refresh"
  | "signUp"
  | "confirmSignUp"
  | "resendCode"
  | "forgotPassword"
  | "confirmForgotPassword";

/**
 * Synthetic error name for a NotAuthorizedException caused by a wrong or rotated
 * client secret (L14): a configuration failure, answered as `unavailable` and
 * reported through onServiceError, never as invalid credentials or a bad code.
 */
export const SECRET_HASH_MISMATCH = "SecretHashMismatch";

/** `ok` = existence-hiding silent success (the same answer as a delivered code). */
type Mapped = CognitoFailureReason | "ok";

const THROTTLED: Record<string, Mapped> = {
  LimitExceededException: "too_many_attempts",
  TooManyRequestsException: "too_many_attempts",
  TooManyFailedAttemptsException: "too_many_attempts",
};

const CODE_ERRORS: Record<string, Mapped> = {
  CodeMismatchException: "code_mismatch",
  ExpiredCodeException: "code_expired",
  // Unknown user, already confirmed, wrong state: indistinguishable from a wrong code.
  UserNotFoundException: "code_mismatch",
  NotAuthorizedException: "code_mismatch",
  UserNotConfirmedException: "code_mismatch",
  AliasExistsException: "code_mismatch",
};

// Account-state answers for "send me a code" become the success answer.
const SILENT_SEND: Record<string, Mapped> = {
  UserNotFoundException: "ok",
  UserNotConfirmedException: "ok",
  InvalidParameterException: "ok", // already confirmed / no verified email
  NotAuthorizedException: "ok",
};

const TABLE: Record<CognitoClientOperation, Record<string, Mapped>> = {
  signIn: {
    ...THROTTLED,
    NotAuthorizedException: "invalid_credentials",
    UserNotFoundException: "invalid_credentials",
    PasswordResetRequiredException: "invalid_credentials",
    // Only reached after a correct password when the app client has
    // PreventUserExistenceErrors=ENABLED (L9/L10, checklist 2c); a wrong password
    // on an unconfirmed account is NotAuthorizedException, so this leaks nothing.
    UserNotConfirmedException: "not_confirmed",
  },
  refresh: {
    ...THROTTLED,
    NotAuthorizedException: "invalid_credentials",
    UserNotFoundException: "invalid_credentials",
  },
  signUp: {
    ...THROTTLED,
    UsernameExistsException: "email_taken",
    InvalidPasswordException: "invalid_password",
  },
  confirmSignUp: { ...THROTTLED, ...CODE_ERRORS },
  confirmForgotPassword: {
    ...THROTTLED,
    ...CODE_ERRORS,
    InvalidPasswordException: "invalid_password",
  },
  resendCode: { ...THROTTLED, ...SILENT_SEND },
  forgotPassword: { ...THROTTLED, ...SILENT_SEND },
};

/** Maps a sanitized Cognito error name; anything unlisted is `unavailable`. */
export function mapCognitoError(operation: CognitoClientOperation, errorName: string): Mapped {
  return Object.hasOwn(TABLE[operation], errorName) ? TABLE[operation][errorName] : "unavailable";
}
