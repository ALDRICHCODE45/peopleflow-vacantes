import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GO_JSON_V1_FIXTURE,
  GO_JSON_V1_RICH_FIXTURE,
  isPositiveGoJsonV1Case,
  loadGoJsonV1Fixture,
  loadGoJsonV1RichFixture,
  reviveGoJsonV1NumberToken,
  type GoJsonV1PositiveCase,
  type GoJsonV1RejectionCase,
} from "../../draft-contract-fixtures/go-json-v1.loader";
import {
  GO_JSON_V1_MAX_DEPTH,
  GO_JSON_V1_MAX_VALUES,
  GoJsonV1EncodeError,
  encodeGoJsonV1,
  type GoJsonV1ErrorCode,
} from "./canonical";
import { draftRichDescriptionStructureSchema } from "./grammar";

/**
 * Frontend execution of the canonical `go-json-v1` encoder against the two
 * immutable, backend-measured corpora.
 *
 * Evidence boundary: these expectations were produced by the backend encoder
 * and received byte-for-byte; this suite runs the frontend encoder over the
 * same pinned inputs. It does not execute Go, the HTTP API, a browser, a rich
 * byte budget or a DTO fingerprint, and it makes no raw duplicate-key or
 * lone-surrogate-decode claim (JavaScript cannot reconstruct raw JSON
 * provenance). Passing both corpora is identical-input evidence, not a claim of
 * universal cross-language parity.
 */

const B2 = loadGoJsonV1Fixture();
const B3 = loadGoJsonV1RichFixture();

const encodeText = (input: unknown): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(encodeGoJsonV1(input));

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const captureCode = (input: unknown): GoJsonV1ErrorCode | "no-error" => {
  try {
    encodeGoJsonV1(input);
    return "no-error";
  } catch (error) {
    if (error instanceof GoJsonV1EncodeError) return error.code;
    throw error;
  }
};

const nestedArray = (depth: number, tail: unknown): unknown => {
  let current = tail;
  for (let index = 0; index < depth - 1; index += 1) current = [current];
  return current;
};

const expectPinnedBytes = (testCase: GoJsonV1PositiveCase): void => {
  const bytes = encodeGoJsonV1(testCase.input);
  const literalBytes = new TextEncoder().encode(testCase.expectedUtf8);

  expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(testCase.expectedUtf8);
  expect(hexOf(bytes)).toBe(testCase.expectedHex);
  expect(bytes.byteLength).toBe(testCase.expectedByteLength);
  expect(sha256Of(bytes)).toBe(testCase.expectedSha256);

  // The authored literals must also be internally consistent with each other.
  expect(hexOf(literalBytes)).toBe(testCase.expectedHex);
  expect(literalBytes.byteLength).toBe(testCase.expectedByteLength);
  expect(sha256Of(literalBytes)).toBe(testCase.expectedSha256);
};

const B2_NAMES = [
  "null_scalar",
  "bool_true",
  "bool_false",
  "int64_zero",
  "int64_negative_one",
  "int64_max",
  "int64_min",
  "empty_string",
  "ascii_string",
  "quote_and_backslash",
  "control_escaping",
  "html_escaping",
  "line_separator_escaping",
  "unicode_not_escaped",
  "combining_not_normalized",
  "empty_array",
  "array_mark_order",
  "empty_object",
  "empty_map_key",
  "property_order",
  "key_html_escaping_order",
  "presence_null_and_empty",
  "presence_absent_key_not_added",
  "nested_mixed_order",
  "non_ascii_map_key_rejected",
  "rich_draft_shape",
];

const B3_NAMES = [
  "paragraph_content_omitted",
  "paragraph_content_empty_array",
  "text_marks_omitted",
  "text_marks_empty_array",
  "marks_bold_then_italic",
  "marks_italic_then_bold",
  "text_emoji",
  "text_nfc_e_acute",
  "text_decomposed_e_acute",
  "text_html_characters",
  "text_real_line_separators",
  "text_literal_line_separator_escapes",
  "ordered_list_start_three",
  "ordered_list_start_max_int32",
  "hard_break_bold_between_text",
  "text_font_size_preset_normal",
];

describe("immutable go-json-v1 corpora", () => {
  it("pins the B2 artifact bytes and descriptor constants", () => {
    expect(GO_JSON_V1_FIXTURE.byteLength).toBe(11940);
    expect(GO_JSON_V1_FIXTURE.sha256).toBe(
      "3a40540c756ca709d63efddeea97ee041c22547d69126041bdc3051fb79f9c72",
    );
    expect(B2.fixtureId).toBe("go-json-v1");
    expect(B2.schemaVersion).toBe(1);
    expect(B2.byteLength).toBe(11940);
    expect(B2.sha256).toBe(GO_JSON_V1_FIXTURE.sha256);
  });

  it("pins the B3 artifact bytes and descriptor constants", () => {
    expect(GO_JSON_V1_RICH_FIXTURE.byteLength).toBe(20353);
    expect(GO_JSON_V1_RICH_FIXTURE.sha256).toBe(
      "382ffbbeffc244811969d9143d4c6c17582b44c10f55e35b5a0ae63b98e882bd",
    );
    expect(B3.fixtureId).toBe("go-json-v1-rich");
    expect(B3.schemaVersion).toBe(1);
    expect(B3.byteLength).toBe(20353);
    expect(B3.sha256).toBe(GO_JSON_V1_RICH_FIXTURE.sha256);
  });

  it("loads exactly the 26 pinned B2 cases with only the named rejection", () => {
    const names = B2.cases.map((testCase) => testCase.name);
    expect(B2.cases).toHaveLength(26);
    expect(new Set(names).size).toBe(26);
    expect(names).toEqual(B2_NAMES);
    const rejections = B2.cases.filter(
      (testCase): testCase is GoJsonV1RejectionCase => !isPositiveGoJsonV1Case(testCase),
    );
    expect(rejections.map((testCase) => testCase.name)).toEqual(["non_ascii_map_key_rejected"]);
    expect(rejections[0]?.expectedError).toBe("ErrNonASCIIKey");
  });

  it("loads exactly the 16 pinned B3 cases, all positive", () => {
    const names = B3.cases.map((testCase) => testCase.name);
    expect(B3.cases).toHaveLength(16);
    expect(new Set(names).size).toBe(16);
    expect(names).toEqual(B3_NAMES);
    expect(B3.cases.every(isPositiveGoJsonV1Case)).toBe(true);
  });
});

describe("frontend encoder against the pinned B2 expectations", () => {
  const positive = B2.cases.filter(isPositiveGoJsonV1Case);

  it("has 25 positive cases plus one declared rejection", () => {
    expect(positive).toHaveLength(25);
    expect(B2.cases.length - positive.length).toBe(1);
  });

  it.each(positive)("$name matches pinned utf8/hex/byteLength/sha256", (testCase) => {
    expectPinnedBytes(testCase);
  });

  it("rejects the named B2 non-ASCII key case with the pinned code", () => {
    const rejection = B2.cases.find(
      (testCase): testCase is GoJsonV1RejectionCase =>
        !isPositiveGoJsonV1Case(testCase) && testCase.expectedError === "ErrNonASCIIKey",
    );
    expect(rejection).toBeDefined();
    expect(captureCode(rejection?.input)).toBe("ErrNonASCIIKey");
  });
});

describe("frontend encoder against the immutable B3 rich envelopes", () => {
  it("accepts every B3 input under the actual approved structural schema", () => {
    for (const testCase of B3.cases) {
      const parsed = draftRichDescriptionStructureSchema.safeParse(testCase.input);
      expect(parsed.success, `${testCase.name}: approved structural grammar`).toBe(true);
    }
  });

  const positive = B3.cases.filter(isPositiveGoJsonV1Case);

  it.each(positive)("$name matches pinned utf8/hex/byteLength/sha256", (testCase) => {
    expectPinnedBytes(testCase);
  });
});

describe("lossless fixture integer loading", () => {
  it("rebuilds unsafe integer tokens with BigInt(source)", () => {
    expect(
      reviveGoJsonV1NumberToken("max", 9223372036854776000, { source: "9223372036854775807" }),
    ).toBe(BigInt("9223372036854775807"));
    expect(
      reviveGoJsonV1NumberToken("min", -9223372036854776000, { source: "-9223372036854775808" }),
    ).toBe(BigInt("-9223372036854775808"));
  });

  it("fails closed when context.source is unavailable for an unsafe integer", () => {
    expect(() => reviveGoJsonV1NumberToken("max", 9223372036854776000, undefined)).toThrow(
      /context\.source/,
    );
  });

  it("leaves safe integers, fractions and non-numbers untouched", () => {
    expect(reviveGoJsonV1NumberToken("one", 1, { source: "1" })).toBe(1);
    expect(reviveGoJsonV1NumberToken("fraction", 1.5, { source: "1.5" })).toBe(1.5);
    expect(reviveGoJsonV1NumberToken("text", "x")).toBe("x");
  });

  it("loads the B2 int64 extremes as bigint, never as rounded numbers", () => {
    expect(typeof B2.cases.find((testCase) => testCase.name === "int64_max")?.input).toBe("bigint");
    expect(typeof B2.cases.find((testCase) => testCase.name === "int64_min")?.input).toBe("bigint");
  });
});

describe("frontend-only adversarial boundaries", () => {
  it("sorts integer-like raw keys lexicographically, not by JS enumeration order", () => {
    const input: Record<string, number> = { "2": 2, "10": 1, "1": 3 };
    expect(Object.keys(input)).toEqual(["1", "2", "10"]);
    expect(encodeText(input)).toBe('{"1":3,"10":1,"2":2}');
  });

  it("matches default Go HTML, separator and control escaping", () => {
    expect(encodeText("<>&\u2028\u2029")).toBe('"\\u003c\\u003e\\u0026\\u2028\\u2029"');
    expect(encodeText("\u0000\t\n\r\b\f\u001f")).toBe('"\\u0000\\t\\n\\r\\b\\f\\u001f"');
    expect(encodeText("\u007f")).toBe('"\u007f"');
    expect(encodeText('say "hi" \\ done')).toBe('"say \\"hi\\" \\\\ done"');
  });

  it("keeps literal backslash-u separators distinct from real separators", () => {
    expect(encodeText("\\u2028")).toBe('"\\\\u2028"');
    expect(encodeText("\u2028")).toBe('"\\u2028"');
  });

  it("encodes non-ASCII text as literal UTF-8 without normalization", () => {
    expect(encodeText("caf\u00e9")).toBe('"caf\u00e9"');
    expect(encodeText("e\u0301")).toBe('"e\u0301"');
    expect(encodeText("\u{1F600}")).toBe('"\u{1F600}"');
  });

  it("rejects unpaired UTF-16 surrogates and accepts a valid pair", () => {
    expect(captureCode("\uD800")).toBe("ErrInvalidUTF8");
    expect(captureCode("\uDC00")).toBe("ErrInvalidUTF8");
    expect(captureCode("a\uD83Db")).toBe("ErrInvalidUTF8");
    expect(encodeText("\uD83D\uDE00")).toBe('"\u{1F600}"');
  });

  it("accepts exactly the signed int64 bigint range", () => {
    expect(encodeText(BigInt("9223372036854775807"))).toBe("9223372036854775807");
    expect(encodeText(BigInt("-9223372036854775808"))).toBe("-9223372036854775808");
    expect(captureCode(BigInt("9223372036854775808"))).toBe("ErrInt64Range");
    expect(captureCode(BigInt("-9223372036854775809"))).toBe("ErrInt64Range");
  });

  it("accepts safe-integer numbers only and encodes negative zero as zero", () => {
    expect(encodeText(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    expect(encodeText(Number.MIN_SAFE_INTEGER)).toBe("-9007199254740991");
    expect(encodeText(-0)).toBe("0");
    expect(captureCode(Number.MAX_SAFE_INTEGER + 1)).toBe("ErrUnsupportedType");
    expect(captureCode(0.5)).toBe("ErrUnsupportedType");
    expect(captureCode(Number.NaN)).toBe("ErrUnsupportedType");
    expect(captureCode(Number.POSITIVE_INFINITY)).toBe("ErrUnsupportedType");
    expect(captureCode(Number.NEGATIVE_INFINITY)).toBe("ErrUnsupportedType");
  });

  it("rejects unsupported values rather than coercing or dropping them", () => {
    class Marker {
      readonly value = 1;
    }
    expect(captureCode(undefined)).toBe("ErrUnsupportedType");
    expect(captureCode(() => 1)).toBe("ErrUnsupportedType");
    expect(captureCode(Symbol("marker"))).toBe("ErrUnsupportedType");
    expect(captureCode(new Date(0))).toBe("ErrUnsupportedType");
    expect(captureCode(new Map())).toBe("ErrUnsupportedType");
    expect(captureCode(new Set())).toBe("ErrUnsupportedType");
    expect(captureCode(new Marker())).toBe("ErrUnsupportedType");

    const sparse: unknown[] = [1];
    sparse[2] = 3;
    expect(captureCode(sparse)).toBe("ErrUnsupportedType");

    const extra: unknown[] = [1, 2];
    Object.defineProperty(extra, "extra", { value: 3, enumerable: true });
    expect(captureCode(extra)).toBe("ErrUnsupportedType");

    const symbolKeyed: Record<string, unknown> = {};
    Object.defineProperty(symbolKeyed, Symbol("hidden"), { value: 1, enumerable: true });
    expect(captureCode(symbolKeyed)).toBe("ErrUnsupportedType");

    const nonEnumerable: Record<string, unknown> = {};
    Object.defineProperty(nonEnumerable, "hidden", { value: 1, enumerable: false });
    expect(captureCode(nonEnumerable)).toBe("ErrUnsupportedType");
  });

  it("rejects Array subclasses and non-ordinary array prototypes", () => {
    class ArraySubclass extends Array<number> {
      readonly tag = "subclass";
    }
    const subclass = new ArraySubclass();
    subclass[0] = 1;
    expect(captureCode(subclass)).toBe("ErrUnsupportedType");

    const nullPrototype: unknown[] = [1, 2];
    Object.setPrototypeOf(nullPrototype, null);
    expect(captureCode(nullPrototype)).toBe("ErrUnsupportedType");

    const customPrototype = [1, 2];
    Object.setPrototypeOf(customPrototype, { tag: "custom" });
    expect(captureCode(customPrototype)).toBe("ErrUnsupportedType");

    // An ordinary array from this realm is still accepted.
    expect(encodeText([1, 2])).toBe("[1,2]");
  });

  it("rejects non-ordinary array prototypes without invoking inherited hooks", () => {
    const calls: string[] = [];
    const customPrototype = Object.create(Array.prototype, {
      toJSON: {
        get: () => {
          calls.push("toJSON");
          return () => [];
        },
      },
      length: {
        get: () => {
          calls.push("length");
          return 0;
        },
      },
    });
    const value: unknown[] = [1, 2];
    Object.setPrototypeOf(value, customPrototype);

    expect(captureCode(value)).toBe("ErrUnsupportedType");
    expect(calls).toEqual([]);
  });

  it("accepts null-prototype plain data objects", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.b = 1;
    value.a = 2;
    expect(encodeText(value)).toBe('{"a":2,"b":1}');
  });

  it("never invokes toJSON or property getters", () => {
    const calls: string[] = [];

    expect(
      captureCode({
        a: 1,
        toJSON: () => {
          calls.push("toJSON-function");
          return {};
        },
      }),
    ).toBe("ErrUnsupportedType");

    const withToJsonGetter: Record<string, unknown> = { a: 1 };
    Object.defineProperty(withToJsonGetter, "toJSON", {
      enumerable: true,
      get: () => {
        calls.push("toJSON-getter");
        return () => ({});
      },
    });
    expect(captureCode(withToJsonGetter)).toBe("ErrUnsupportedType");

    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, "value", {
      enumerable: true,
      get: () => {
        calls.push("nested-getter");
        return 1;
      },
    });
    expect(captureCode({ nested })).toBe("ErrUnsupportedType");

    expect(calls).toEqual([]);
  });

  it("does not mutate or reorder frozen input", () => {
    const array = Object.freeze([3, 1, 2]);
    const nested = Object.freeze({ b: 1, a: Object.freeze({ d: array }) });
    const before = JSON.stringify(nested);

    const first = encodeText(nested);
    const second = encodeText(nested);

    expect(first).toBe('{"a":{"d":[3,1,2]},"b":1}');
    expect(second).toBe(first);
    expect(JSON.stringify(nested)).toBe(before);
    expect(Object.keys(nested)).toEqual(["b", "a"]);
  });

  it("appends no trailing newline or other terminator", () => {
    const bytes = encodeGoJsonV1({ a: 1 });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
    expect(bytes[bytes.byteLength - 1]).toBe(0x7d);
  });
});

describe("frontend-only technical limits", () => {
  it("accepts depth 128 and rejects depth 129 without stack overflow", () => {
    expect(GO_JSON_V1_MAX_DEPTH).toBe(128);
    expect(encodeText(nestedArray(128, 1))).toBe("[".repeat(127) + "1" + "]".repeat(127));
    expect(encodeText(nestedArray(128, []))).toBe("[".repeat(128) + "]".repeat(128));
    expect(captureCode(nestedArray(129, 1))).toBe("ErrDepthLimit");
    expect(captureCode(nestedArray(129, []))).toBe("ErrDepthLimit");
    expect(captureCode(nestedArray(128, { a: null }))).toBe("ErrDepthLimit");
    // Depth is checked before a wide child set is fanned out.
    expect(captureCode(nestedArray(128, new Array(200000).fill(null)))).toBe("ErrDepthLimit");
  });

  it("accepts exactly 131072 value occurrences and rejects 131073", () => {
    expect(GO_JSON_V1_MAX_VALUES).toBe(131072);
    const accepted = encodeGoJsonV1(new Array(131071).fill(null));
    expect(accepted.byteLength).toBe(2 + 131071 * 4 + 131070);
    expect(captureCode(new Array(131072).fill(null))).toBe("ErrValueLimit");
  });

  it("does not count map keys as value occurrences", () => {
    const value: Record<string, null> = {};
    for (let index = 0; index <= 131070; index += 1) value[`k${index}`] = null;
    expect(Object.keys(value)).toHaveLength(131071);
    expect(encodeGoJsonV1(value).byteLength).toBeGreaterThan(0);
  });

  it("reserves nested children before descent at the inclusive occurrence boundary", () => {
    // root object (1) + nested array (1) + 131070 nulls = 131072, exactly inclusive.
    expect(captureCode({ a: new Array(131070).fill(null) })).toBe("no-error");
    // root object (1) + nested array (1) + 131071 nulls = 131073, one over.
    expect(captureCode({ a: new Array(131071).fill(null) })).toBe("ErrValueLimit");
  });

  it("allocates one cursor frame per open level instead of one per child", () => {
    const nested = nestedArray(128, 1);
    const wide = new Array(131071).fill(null);

    // Scoped, bounded instrumentation: count actual stack pushes only for the
    // two calls below. This is structural evidence for the O(depth) cursor
    // stack, not behavioral RED and not a public diagnostic API.
    const originalPush = Array.prototype.push;
    let pushCount = 0;
    Array.prototype.push = function countingPush(this: unknown[], ...items: unknown[]): number {
      pushCount += items.length;
      return originalPush.apply(this, items);
    } as typeof Array.prototype.push;

    let widePushes = 0;
    let nestedPushes = 0;
    try {
      encodeGoJsonV1(wide);
      widePushes = pushCount;
      pushCount = 0;
      encodeGoJsonV1(nested);
      nestedPushes = pushCount;
    } finally {
      Array.prototype.push = originalPush;
    }

    // A per-child pending-frame stack would push ~131071 frames for the wide
    // array; a cursor stack pushes at most one frame per open level.
    expect(widePushes).toBeLessThanOrEqual(2);
    expect(nestedPushes).toBeLessThanOrEqual(128);
  });

  it("terminates on cycles instead of overflowing the stack", () => {
    const selfReferential: Record<string, unknown> = {};
    selfReferential.self = selfReferential;
    expect(captureCode(selfReferential)).toBe("ErrDepthLimit");

    const selfSlice: unknown[] = [null];
    selfSlice[0] = selfSlice;
    expect(captureCode(selfSlice)).toBe("ErrDepthLimit");

    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = { first };
    first.second = second;
    expect(captureCode(first)).toBe("ErrDepthLimit");
  });

  it("counts repeated references per occurrence and encodes them independently", () => {
    const shared = new Array(65535).fill(null);
    expect(captureCode([shared])).toBe("no-error");
    expect(captureCode([shared, shared])).toBe("ErrValueLimit");

    const leaf = { kind: "shared" };
    expect(encodeText([leaf, leaf])).toBe('[{"kind":"shared"},{"kind":"shared"}]');
  });
});
