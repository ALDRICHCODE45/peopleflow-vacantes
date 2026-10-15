/**
 * Closed Go contract for the temporary local identity bootstrap.
 *
 * Responses are decoded against an exact key whitelist: unknown or extra fields
 * never become part of a result, and a status that does not match the code's
 * whitelisted status is rejected. Only sanitized, PII-free operands and codes
 * are represented here.
 */
export const LOCAL_BOOTSTRAP_EXPIRES_IN_SECONDS = 60;
export const LOCAL_BOOTSTRAP_OPERATION_CODE_LENGTH = 26;

/** Uppercase RFC4648 base32, unpadded: 16 bytes / 128 bits -> 26 characters. */
const OPERATION_CODE_PATTERN = /^[A-Z2-7]{26}$/;

/**
 * Canonical base32 of 16 bytes leaves 2 zero pad bits in the final character,
 * so only these final characters encode a canonical 128-bit value.
 */
const CANONICAL_PAD_LAST_CHARS = "AEIMQUY4";

export const LOCAL_BOOTSTRAP_ERROR_STATUSES = {
  invalid_request: [400],
  unauthenticated: [401],
  bootstrap_forbidden: [403],
  stage_pending: [409],
  approval_required: [409],
  identity_conflict: [409],
  operation_expired: [410],
  identity_provider_unavailable: [502],
  bootstrap_failed: [500],
} as const satisfies Record<string, readonly number[]>;

export type LocalBootstrapErrorCode = keyof typeof LOCAL_BOOTSTRAP_ERROR_STATUSES;
export type LocalBootstrapStageSuccess = { operation_code: string; expires_in: number };
export type LocalBootstrapApplySuccess = { code: "created" | "already_exists" };

export function isOperationCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    OPERATION_CODE_PATTERN.test(value) &&
    CANONICAL_PAD_LAST_CHARS.includes(value[25])
  );
}

export function decodeStageSuccess(value: unknown): LocalBootstrapStageSuccess {
  const record = exactRecord(value, ["ok", "operation_code", "expires_in"]);
  if (
    record.ok !== true ||
    !isOperationCode(record.operation_code) ||
    record.expires_in !== LOCAL_BOOTSTRAP_EXPIRES_IN_SECONDS
  )
    throw new Error("invalid stage response");
  return { operation_code: record.operation_code, expires_in: record.expires_in };
}

export function decodeApplySuccess(value: unknown): LocalBootstrapApplySuccess {
  const record = exactRecord(value, ["ok", "code"]);
  if (record.ok !== true || (record.code !== "created" && record.code !== "already_exists"))
    throw new Error("invalid apply response");
  return { code: record.code };
}

export function decodeErrorEnvelope(value: unknown, status: number): LocalBootstrapErrorCode {
  const record = exactRecord(value, ["ok", "code"]);
  if (record.ok !== false || typeof record.code !== "string")
    throw new Error("invalid error envelope");
  if (!Object.prototype.hasOwnProperty.call(LOCAL_BOOTSTRAP_ERROR_STATUSES, record.code))
    throw new Error("invalid error envelope");
  const code = record.code as LocalBootstrapErrorCode;
  const statuses: readonly number[] = LOCAL_BOOTSTRAP_ERROR_STATUSES[code];
  if (!statuses.includes(status)) throw new Error("invalid error envelope");
  return code;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid response");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  )
    throw new Error("invalid response");
  return record;
}
