import { describe, expect, it } from "vitest";
import {
  LOCAL_BOOTSTRAP_EXPIRES_IN_SECONDS,
  decodeApplySuccess,
  decodeErrorEnvelope,
  decodeStageSuccess,
  isOperationCode,
} from "./contract";
import { FIXTURE_OPERATION_CODE } from "./fixtures";

describe("operation code contract", () => {
  it("accepts exactly 26 uppercase RFC4648 base32 characters", () => {
    expect(FIXTURE_OPERATION_CODE).toHaveLength(26);
    expect(isOperationCode(FIXTURE_OPERATION_CODE)).toBe(true);
  });

  it.each([
    FIXTURE_OPERATION_CODE.toLowerCase(),
    FIXTURE_OPERATION_CODE.slice(0, 25),
    `${FIXTURE_OPERATION_CODE}A`,
    "ABCDEFGHIJKLMNOPQRSTUVWXY0",
    "ABCDEFGHIJKLMNOPQRSTUVWXY1",
    "ABCDEFGHIJKLMNOPQRSTUVWXY8",
    "ABCDEFGHIJKLMNOPQRSTUVWXY9",
    "ABCDEFGHIJKLMNOPQRSTUVWXY-",
    "",
    null,
    26,
  ])("rejects a malformed code (%j)", (value) => {
    expect(isOperationCode(value)).toBe(false);
  });

  it("enforces canonical 16-byte padding: the final character must carry zero pad bits", () => {
    expect("AEIMQUY4").toContain(FIXTURE_OPERATION_CODE.at(-1));
    for (const value of [
      "ABCDEFGHIJKLMNOPQRSTUVWXYB",
      "ABCDEFGHIJKLMNOPQRSTUVWXYC",
      "ABCDEFGHIJKLMNOPQRSTUVWXY7",
    ]) {
      expect(isOperationCode(value)).toBe(false);
    }
    expect(isOperationCode("ABCDEFGHIJKLMNOPQRSTUVWXYA")).toBe(true);
  });
});

describe("decodeStageSuccess", () => {
  const valid = { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 };

  it("accepts the exact 202 success schema", () => {
    expect(LOCAL_BOOTSTRAP_EXPIRES_IN_SECONDS).toBe(60);
    expect(decodeStageSuccess(valid)).toEqual({
      operation_code: FIXTURE_OPERATION_CODE,
      expires_in: 60,
    });
  });

  it.each([
    { ...valid, extra: "leak" },
    { ok: true, operation_code: FIXTURE_OPERATION_CODE },
    { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 61 },
    { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: "60" },
    { ok: false, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
    { ok: true, operation_code: FIXTURE_OPERATION_CODE.toLowerCase(), expires_in: 60 },
    null,
    [],
  ])("rejects anything outside the exact schema (%j)", (value) => {
    expect(() => decodeStageSuccess(value)).toThrow();
  });
});

describe("decodeApplySuccess", () => {
  it.each(["created", "already_exists"])("accepts the exact 200 schema for %s", (code) => {
    expect(decodeApplySuccess({ ok: true, code })).toEqual({ code });
  });

  it.each([
    { ok: true, code: "updated" },
    { ok: true },
    { ok: true, code: "created", extra: 1 },
    { ok: false, code: "created" },
    "created",
    null,
  ])("rejects (%j)", (value) => {
    expect(() => decodeApplySuccess(value)).toThrow();
  });
});

describe("decodeErrorEnvelope", () => {
  it.each([
    [400, "invalid_request"],
    [401, "unauthenticated"],
    [403, "bootstrap_forbidden"],
    [409, "stage_pending"],
    [409, "approval_required"],
    [409, "identity_conflict"],
    [410, "operation_expired"],
    [502, "identity_provider_unavailable"],
    [500, "bootstrap_failed"],
  ] as const)("accepts the whitelisted %i/%s pair", (status, code) => {
    expect(decodeErrorEnvelope({ ok: false, code }, status)).toBe(code);
  });

  it.each([
    [200, "invalid_request"],
    [201, "unauthenticated"],
    [403, "unauthenticated"],
    [409, "invalid_request"],
    [410, "approval_required"],
    [500, "identity_conflict"],
    [502, "bootstrap_failed"],
  ] as const)("rejects the non-whitelisted %i/%s pair", (status, code) => {
    expect(() => decodeErrorEnvelope({ ok: false, code }, status)).toThrow();
  });

  it.each([
    { ok: false, code: "invalid_request", error: "raw upstream detail" },
    { ok: false, code: "new_code" },
    { ok: false },
    { ok: true, code: "invalid_request" },
    "invalid_request",
    null,
  ])("rejects unknown, missing or extra fields (%j)", (value) => {
    expect(() => decodeErrorEnvelope(value, 400)).toThrow();
  });
});
