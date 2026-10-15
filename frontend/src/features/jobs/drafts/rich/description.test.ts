import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  isPositiveGoJsonV1Case,
  loadGoJsonV1RichFixture,
} from "../../draft-contract-fixtures/go-json-v1.loader";
import * as canonicalModule from "./canonical";
import { draftRichDescriptionSchema } from "./description";
import * as plainModule from "./plain";

/**
 * Unit tests for the composed rich-description schema.
 *
 * The canonical boundaries are derived from an explicit literal envelope and
 * per-character canonical byte costs, never from the encoder under test, so the
 * expectations are independent of the implementation. Scoped `vi.spyOn` spies
 * on the approved derivation/encoder modules observe whether those steps ran;
 * each spy is restored in a `finally` block. That is structural evidence only,
 * not a public diagnostic API.
 */

const B3 = loadGoJsonV1RichFixture();

const text = (value: string, marks?: unknown): Record<string, unknown> =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
const paragraph = (content?: unknown): Record<string, unknown> =>
  content === undefined ? { type: "paragraph" } : { type: "paragraph", content };
const doc = (content: unknown): Record<string, unknown> => ({ type: "doc", content });
const envelope = (document: unknown): Record<string, unknown> => ({
  schema_version: 1,
  document,
});
const simpleEnvelope = (value: string): unknown => envelope(doc([paragraph([text(value)])]));

const BOLD = { type: "bold" } as const;
const ITALIC = { type: "italic" } as const;

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Fixed canonical bytes of `{"schema_version":1,"document":…}` for a single
 * paragraph/text document, corroborated by the explicit literal below. The
 * per-character payload bytes are added separately so the padding never comes
 * from the encoder under test.
 */
const SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES = 117;

/** The exact canonical envelope literal for unescaped ASCII payloads. */
const simpleEnvelopeLiteral = (value: string): string =>
  `{"document":{"content":[{"content":[{"text":"${value}","type":"text"}],"type":"paragraph"}],"type":"doc"},"schema_version":1}`;

type DescriptionParseResult = ReturnType<typeof draftRichDescriptionSchema.safeParse>;

const firstIssueParams = (error: z.ZodError): unknown => {
  const issue = error.issues[0];
  return issue?.code === z.ZodIssueCode.custom ? issue.params : undefined;
};

/**
 * Parse once while observing whether the approved plain derivation and the
 * approved canonical encoder were invoked. Both spies are restored in `finally`.
 */
const observeSchema = (
  input: unknown,
): { result: DescriptionParseResult; encoderCalls: number; plainCalls: number } => {
  const encoderSpy = vi.spyOn(canonicalModule, "encodeGoJsonV1");
  const plainSpy = vi.spyOn(plainModule, "deriveDraftDescriptionPlain");
  try {
    return {
      result: draftRichDescriptionSchema.safeParse(input),
      encoderCalls: encoderSpy.mock.calls.length,
      plainCalls: plainSpy.mock.calls.length,
    };
  } finally {
    encoderSpy.mockRestore();
    plainSpy.mockRestore();
  }
};

const parseOutcome = (
  input: unknown,
): {
  success: boolean;
  params: unknown;
  encoderCalls: number;
  plainCalls: number;
} => {
  const { result, encoderCalls, plainCalls } = observeSchema(input);
  return {
    success: result.success,
    params: result.success ? undefined : firstIssueParams(result.error),
    encoderCalls,
    plainCalls,
  };
};

const rejectParams = (input: unknown): unknown => {
  const result = draftRichDescriptionSchema.safeParse(input);
  return result.success ? undefined : firstIssueParams(result.error);
};

describe("single composed schema", () => {
  it("accepts null and performs no derivation or encoding", () => {
    const outcome = parseOutcome(null);
    expect(outcome.success).toBe(true);
    expect(outcome.encoderCalls).toBe(0);
    expect(outcome.plainCalls).toBe(0);
  });

  it("returns the validated description unchanged without derived fields", () => {
    const description = envelope(
      doc([
        paragraph(),
        paragraph([]),
        paragraph([text("x")]),
        paragraph([text("x", [])]),
        paragraph([text("x", [BOLD, ITALIC])]),
        paragraph([text("x", [ITALIC, BOLD])]),
      ]),
    );
    const snapshot = structuredClone(description);

    const result = draftRichDescriptionSchema.safeParse(description);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toStrictEqual(snapshot);
    expect(Object.keys(result.data as object)).toStrictEqual(["schema_version", "document"]);
    expect(JSON.stringify(result.data)).not.toContain("description_plain");

    const content = (result.data as { document: { content: Array<Record<string, unknown>> } })
      .document.content;
    expect(content[0]).toStrictEqual({ type: "paragraph" });
    expect(content[1]).toStrictEqual({ type: "paragraph", content: [] });
    expect((content[2] as { content: Array<Record<string, unknown>> }).content[0]).toStrictEqual({
      type: "text",
      text: "x",
    });
    expect((content[3] as { content: Array<Record<string, unknown>> }).content[0]).toStrictEqual({
      type: "text",
      text: "x",
      marks: [],
    });
    expect(
      (content[4] as { content: Array<{ marks: unknown[] }> }).content[0]?.marks,
    ).toStrictEqual([BOLD, ITALIC]);
    expect(
      (content[5] as { content: Array<{ marks: unknown[] }> }).content[0]?.marks,
    ).toStrictEqual([ITALIC, BOLD]);
    expect(description).toStrictEqual(snapshot);
  });
});

describe("whole-grammar rejection before derivation and encoding", () => {
  const invalid: Array<[string, unknown]> = [
    ["unknown version", { schema_version: 2, document: doc([paragraph()]) }],
    ["missing document", { schema_version: 1 }],
    ["null document", { schema_version: 1, document: null }],
    ["empty doc", envelope(doc([]))],
    ["invalid suffix node", envelope(doc([paragraph([text("ok")]), { type: "heading" }]))],
    ["invalid last mark", envelope(doc([paragraph([text("ok", [BOLD, { type: "strike" }])])]))],
  ];

  it.each(invalid)("rejects %s without deriving or encoding", (_name, description) => {
    const outcome = parseOutcome(description);
    expect(outcome.success).toBe(false);
    expect(outcome.plainCalls).toBe(0);
    expect(outcome.encoderCalls).toBe(0);
  });
});

describe("whole-envelope canonical byte budget", () => {
  it("corroborates the 117-byte overhead against the explicit literal", () => {
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES).toBe(117);
    expect(utf8Length(simpleEnvelopeLiteral(""))).toBe(117);
    expect(utf8Length(simpleEnvelopeLiteral("a".repeat(10)))).toBe(127);
  });

  it("accepts exactly 65536 ASCII bytes and rejects 65537", () => {
    const boundary = "a".repeat(65536 - SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES);
    expect(utf8Length(simpleEnvelopeLiteral(boundary))).toBe(65536);
    expect(draftRichDescriptionSchema.safeParse(simpleEnvelope(boundary)).success).toBe(true);

    const over = "a".repeat(65536 - SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 1);
    expect(utf8Length(simpleEnvelopeLiteral(over))).toBe(65537);
    expect(rejectParams(simpleEnvelope(over))).toMatchObject({ kind: "canonical_budget" });
  });

  it("measures UTF-8 bytes rather than UTF-16 units for astral text", () => {
    const emoji = "\u{1F600}";
    const boundary = emoji.repeat(16354) + "aaa";
    expect(utf8Length(simpleEnvelopeLiteral(boundary))).toBe(65536);
    expect(draftRichDescriptionSchema.safeParse(simpleEnvelope(boundary)).success).toBe(true);
    expect(rejectParams(simpleEnvelope(emoji.repeat(16355)))).toMatchObject({
      kind: "canonical_budget",
    });
  });

  it("measures multibyte BMP text in UTF-8 bytes", () => {
    const boundary = "\u00e9".repeat(32709) + "a";
    expect(utf8Length(simpleEnvelopeLiteral(boundary))).toBe(65536);
    expect(draftRichDescriptionSchema.safeParse(simpleEnvelope(boundary)).success).toBe(true);
    const over = boundary + "a";
    expect(utf8Length(simpleEnvelopeLiteral(over))).toBe(65537);
    expect(rejectParams(simpleEnvelope(over))).toMatchObject({
      kind: "canonical_budget",
    });
  });

  it("rejects HTML escape expansion that the string-unit lower bound cannot see", () => {
    const boundary = "<".repeat(10903) + "a";
    const over = boundary + "a";
    expect(utf8Length(simpleEnvelopeLiteral("\\u003c".repeat(10903) + "a"))).toBe(65536);
    expect(utf8Length(simpleEnvelopeLiteral("\\u003c".repeat(10903) + "aa"))).toBe(65537);
    const accepted = parseOutcome(simpleEnvelope(boundary));
    expect(accepted.success).toBe(true);
    // The bound stayed under the limit, so acceptance came from the encoder's
    // real byte length: the plain derivation and the encoder both ran.
    expect(accepted.plainCalls).toBe(1);
    expect(accepted.encoderCalls).toBe(1);
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 6 * 10903 + 1).toBe(65536);

    const rejected = parseOutcome(simpleEnvelope(over));
    expect(rejected.success).toBe(false);
    expect(rejected.params).toMatchObject({ kind: "canonical_budget" });
    // The encoder measured the expansion (`\u003c` per `<`), so it ran.
    expect(rejected.encoderCalls).toBe(1);
  });

  it("distinguishes a real U+2028 from the literal backslash-u2028 escape", () => {
    const realSeparator = "\u2028";
    const literalEscape = "\\u2028";
    expect(realSeparator).not.toBe(literalEscape);
    expect(utf8Length(realSeparator)).toBe(3);
    expect(utf8Length(literalEscape)).toBe(6);

    // Canonical cost per repeat, independent of the encoder:
    //   real U+2028 -> `\u2028` (6 bytes), literal -> `\\u2028` (7 bytes).
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 6 * 10903 + 1).toBe(65536);
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 6 * 10903 + 2).toBe(65537);
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 7 * 9345 + 4).toBe(65536);
    expect(SIMPLE_TEXT_ENVELOPE_OVERHEAD_BYTES + 7 * 9345 + 5).toBe(65537);

    expect(
      draftRichDescriptionSchema.safeParse(simpleEnvelope(realSeparator.repeat(10903) + "a")).success,
    ).toBe(true);
    expect(rejectParams(simpleEnvelope(realSeparator.repeat(10903) + "aa"))).toMatchObject({
      kind: "canonical_budget",
    });
    expect(
      draftRichDescriptionSchema.safeParse(simpleEnvelope(literalEscape.repeat(9345) + "aaaa")).success,
    ).toBe(true);
    expect(rejectParams(simpleEnvelope(literalEscape.repeat(9345) + "aaaaa"))).toMatchObject({
      kind: "canonical_budget",
    });
  });
});

describe("plain budget and encoder rejection are distinct from the canonical budget", () => {
  it("reports a plain-text budget failure with its own discriminator", () => {
    const outcome = parseOutcome(simpleEnvelope("\u00e9".repeat(32769)));
    expect(outcome.success).toBe(false);
    expect(outcome.params).toMatchObject({ kind: "plain_budget" });
    // The failure happened during derivation, before the encoder ran.
    expect(outcome.plainCalls).toBe(1);
    expect(outcome.encoderCalls).toBe(0);
  });

  it("translates a known Unicode encoder rejection into a coded Zod issue", () => {
    const outcome = parseOutcome(simpleEnvelope("\uD800"));
    expect(outcome.success).toBe(false);
    expect(outcome.params).toMatchObject({ kind: "encoding", goJsonV1Code: "ErrInvalidUTF8" });
    // Grammar accepts a lone surrogate, so the encoder had to reject it.
    expect(outcome.encoderCalls).toBe(1);
  });

  it("translates a non-Unicode mechanical rejection reachable from grammar-valid data", () => {
    const node: Record<string, unknown> = { type: "text", text: "x" };
    Object.defineProperty(node, Symbol("hidden"), { value: 1, enumerable: true });
    const outcome = parseOutcome(envelope(doc([paragraph([node])])));
    expect(outcome.success).toBe(false);
    expect(outcome.params).toMatchObject({ kind: "encoding", goJsonV1Code: "ErrUnsupportedType" });
    expect(outcome.encoderCalls).toBe(1);
  });
});

describe("oversized non-plain attributes abort before the encoder", () => {
  it("rejects aggregated link attributes on the string-unit lower bound", () => {
    const href = `https://example.com/${"a".repeat(2000)}`;
    const link = {
      type: "link",
      attrs: { href, target: null, rel: null, class: null, title: null },
    } as const;
    const description = envelope(
      doc(Array.from({ length: 500 }, () => paragraph([text("x", [link])]))),
    );

    const outcome = parseOutcome(description);
    expect(outcome.success).toBe(false);
    expect(outcome.params).toMatchObject({ kind: "canonical_budget" });
    // The derived plain text is tiny (so derivation ran and passed), but the
    // encoder was never called: the lower bound aborted first.
    expect(outcome.plainCalls).toBe(1);
    expect(outcome.encoderCalls).toBe(0);
  });
});

describe("immutable B3 corpus through the pinned loader", () => {
  it("loads exactly the 16 pinned rich envelopes", () => {
    expect(B3.cases).toHaveLength(16);
    expect(B3.cases.every(isPositiveGoJsonV1Case)).toBe(true);
  });

  it("accepts every pinned B3 envelope", () => {
    for (const testCase of B3.cases) {
      const result = draftRichDescriptionSchema.safeParse(testCase.input);
      expect(result.success, `${testCase.name} should be accepted`).toBe(true);
    }
  });
});
