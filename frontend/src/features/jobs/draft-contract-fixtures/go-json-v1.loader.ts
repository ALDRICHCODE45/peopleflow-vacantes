import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test-only loader for the two immutable `go-json-v1` fixture corpora.
 *
 * This module is Node-only on purpose: it reads the received backend artifacts
 * from disk, pins their whole-file byte length and SHA-256, and decodes their
 * JSON with a reviver that keeps unsafe integer tokens lossless. It is never
 * imported by browser/production code and carries no encoder behavior itself.
 *
 * Unsafe integers: a JSON integer such as `9223372036854775807` is rounded by
 * `Number` before any reviver sees it. Node's reviver receives the original
 * token in `context.source`, so the loader rebuilds those tokens with the
 * `BigInt` constructor (ES2017 forbids `BigInt` literals). If `context.source`
 * is unavailable for an unsafe integer the loader fails closed instead of
 * rounding; there is no regex extraction and no generic raw-JSON parser.
 */

/** A received corpus artifact and its verified whole-file identity. */
export interface GoJsonV1FixtureDescriptor {
  readonly fixtureId: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/** Backend B2 corpus: restricted encoder-unit expectations. */
export const GO_JSON_V1_FIXTURE: GoJsonV1FixtureDescriptor = {
  fixtureId: "go-json-v1",
  relativePath: "src/features/jobs/draft-contract-fixtures/go-json-v1.fixtures.json",
  byteLength: 11940,
  sha256: "3a40540c756ca709d63efddeea97ee041c22547d69126041bdc3051fb79f9c72",
};

/** Backend B3 corpus: intended whole rich-description envelopes. */
export const GO_JSON_V1_RICH_FIXTURE: GoJsonV1FixtureDescriptor = {
  fixtureId: "go-json-v1-rich",
  relativePath: "src/features/jobs/draft-contract-fixtures/go-json-v1-rich.fixtures.json",
  byteLength: 20353,
  sha256: "382ffbbeffc244811969d9143d4c6c17582b44c10f55e35b5a0ae63b98e882bd",
};

/** A corpus case with pinned canonical expectations. */
export interface GoJsonV1PositiveCase {
  name: string;
  unit: string;
  input: unknown;
  expectedUtf8: string;
  expectedHex: string;
  expectedByteLength: number;
  expectedSha256: string;
}

/** A corpus case declared as a rejection with a named expected error code. */
export interface GoJsonV1RejectionCase {
  name: string;
  unit: string;
  input: unknown;
  expectedError: string;
}

export type GoJsonV1Case = GoJsonV1PositiveCase | GoJsonV1RejectionCase;

/** A loaded corpus plus the verified artifact identity. */
export interface LoadedGoJsonV1Fixture {
  fixtureId: string;
  schemaVersion: number;
  cases: GoJsonV1Case[];
  byteLength: number;
  sha256: string;
}

/** `context` shape accepted by the V8/Node reviver for number tokens. */
export interface GoJsonV1ReviverContext {
  source?: string;
}

/**
 * Domain type for a decoded fixture value: the JSON data model plus a lossless
 * `bigint` for unsafe integer tokens. `BigInt` appears only here, on the
 * test-only loader boundary; production encoder input stays generic.
 */
export type GoJsonV1FixtureValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | GoJsonV1FixtureValue[]
  | { [key: string]: GoJsonV1FixtureValue };

/** A positive case has the full pinned expectation set. */
export const isPositiveGoJsonV1Case = (value: GoJsonV1Case): value is GoJsonV1PositiveCase =>
  typeof (value as GoJsonV1PositiveCase).expectedUtf8 === "string";

/**
 * Reviver for one loaded fixture value.
 *
 * Safe integers, non-integers and non-numbers pass through unchanged. An
 * unsafe integer is rebuilt from `context.source` with `BigInt`; a missing or
 * non-integer source fails closed rather than silently rounding. Non-integer
 * numbers are left to the caller because this corpus never encodes them.
 */
export function reviveGoJsonV1NumberToken(
  key: string,
  value: GoJsonV1FixtureValue,
  context?: GoJsonV1ReviverContext,
): GoJsonV1FixtureValue {
  if (typeof value !== "number" || Number.isSafeInteger(value) || !Number.isInteger(value)) {
    return value;
  }
  const source = context?.source;
  if (typeof source !== "string") {
    throw new Error(
      `go-json-v1 fixture: unsafe integer token "${key}" has no reviver context.source; refusing to round`,
    );
  }
  try {
    return BigInt(source);
  } catch {
    throw new Error(
      `go-json-v1 fixture: unsafe integer token "${key}" source "${source}" is not an exact integer`,
    );
  }
}

interface ParsedFixture {
  fixtureId: string;
  schemaVersion: number;
  cases: GoJsonV1Case[];
}

function readVerifiedFixtureBytes(descriptor: GoJsonV1FixtureDescriptor): Buffer {
  const absolutePath = join(process.cwd(), descriptor.relativePath);
  const bytes = readFileSync(absolutePath);
  if (bytes.byteLength !== descriptor.byteLength) {
    throw new Error(
      `go-json-v1 fixture ${descriptor.fixtureId}: expected ${descriptor.byteLength} bytes, got ${bytes.byteLength}`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== descriptor.sha256) {
    throw new Error(
      `go-json-v1 fixture ${descriptor.fixtureId}: expected sha256 ${descriptor.sha256}, got ${sha256}`,
    );
  }
  return bytes;
}

function loadFixture(descriptor: GoJsonV1FixtureDescriptor): LoadedGoJsonV1Fixture {
  const bytes = readVerifiedFixtureBytes(descriptor);
  const parsed = JSON.parse(bytes.toString("utf8"), reviveGoJsonV1NumberToken) as ParsedFixture;
  if (parsed.fixtureId !== descriptor.fixtureId) {
    throw new Error(
      `go-json-v1 fixture ${descriptor.fixtureId}: file declares "${parsed.fixtureId}"`,
    );
  }
  return {
    fixtureId: parsed.fixtureId,
    schemaVersion: parsed.schemaVersion,
    cases: parsed.cases,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
  };
}

/** Load the B2 restricted-encoder corpus after verifying its exact bytes. */
export function loadGoJsonV1Fixture(): LoadedGoJsonV1Fixture {
  return loadFixture(GO_JSON_V1_FIXTURE);
}

/** Load the B3 rich-envelope corpus after verifying its exact bytes. */
export function loadGoJsonV1RichFixture(): LoadedGoJsonV1Fixture {
  return loadFixture(GO_JSON_V1_RICH_FIXTURE);
}
