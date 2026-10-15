import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  DRAFT_DESCRIPTION_PLAIN_MAX_BYTES,
  DraftDescriptionPlainBudgetError,
  deriveDraftDescriptionPlain,
} from "./plain";

const text = (value: string, marks?: unknown): Record<string, unknown> =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
const paragraph = (content?: unknown): Record<string, unknown> =>
  content === undefined ? { type: "paragraph" } : { type: "paragraph", content };
const hardBreak = (marks?: unknown): Record<string, unknown> =>
  marks === undefined ? { type: "hardBreak" } : { type: "hardBreak", marks };
const listItem = (content: unknown): Record<string, unknown> => ({ type: "listItem", content });
const bulletList = (content: unknown): Record<string, unknown> => ({ type: "bulletList", content });
const orderedList = (content: unknown, start: unknown = 1): Record<string, unknown> => ({
  type: "orderedList",
  attrs: { start, type: null },
  content,
});
const doc = (content: unknown): Record<string, unknown> => ({ type: "doc", content });
const envelope = (document: unknown): Record<string, unknown> => ({ schema_version: 1, document });

const BOLD = { type: "bold" } as const;
const LINK = {
  type: "link",
  attrs: {
    href: "https://example.com/enlace",
    target: "_blank",
    rel: "noopener",
    class: null,
    title: null,
  },
} as const;

const plain = (description: unknown): string => {
  const value = deriveDraftDescriptionPlain(description);
  if (value === null) throw new Error("expected non-null plain text");
  return value;
};
const bytesOf = (value: string): number => new TextEncoder().encode(value).length;
const longDescription = (value: string): unknown => envelope(doc([paragraph([text(value)])]));

const nested = (wraps: number, leaf: Record<string, unknown>): Record<string, unknown> => {
  let block = leaf;
  for (let i = 0; i < wraps; i += 1) block = bulletList([listItem([paragraph(), block])]);
  return envelope(doc([block]));
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
};

describe("null versus empty", () => {
  it("maps null to null and an empty paragraph to an empty string", () => {
    expect(deriveDraftDescriptionPlain(null)).toBeNull();
    expect(deriveDraftDescriptionPlain(envelope(doc([paragraph()])))).toBe("");
    expect(deriveDraftDescriptionPlain(envelope(doc([paragraph([])])))).toBe("");
    expect(deriveDraftDescriptionPlain(null)).not.toBe(deriveDraftDescriptionPlain(envelope(doc([paragraph()]))));
  });

  it("joins empty paragraphs and empty children with exactly one newline", () => {
    expect(plain(envelope(doc([paragraph(), paragraph()])))).toBe("\n");
    expect(plain(envelope(doc([paragraph(), paragraph(), paragraph()])))).toBe("\n\n");
    expect(plain(envelope(doc([paragraph([]), paragraph([])])))).toBe("\n");
    expect(plain(envelope(doc([paragraph(), paragraph([text("x")])])))).toBe("\nx");
    expect(plain(envelope(doc([paragraph([text("x")]), paragraph()])))).toBe("x\n");
  });
});

describe("inline extraction", () => {
  it("concatenates adjacent text verbatim and turns hardBreak into a newline", () => {
    expect(plain(envelope(doc([paragraph([text("a"), text("b"), text("c")])])))).toBe("abc");
    expect(plain(envelope(doc([paragraph([text("a"), hardBreak(), text("b")])])))).toBe("a\nb");
    expect(plain(envelope(doc([paragraph([hardBreak([BOLD])])])))).toBe("\n");
  });

  it("keeps significant whitespace, combining sequences, FEFF and astral text", () => {
    const significant = " \t\n\u00a0\uFEFFe\u0301\u{1F600} ";
    expect(plain(envelope(doc([paragraph([text(significant)])])))).toBe(significant);
    expect(plain(envelope(doc([paragraph([text("  lead and trail  ")])])))).toBe("  lead and trail  ");
  });

  it("uses the link label rather than the URL and drops mark metadata", () => {
    expect(plain(envelope(doc([paragraph([text("hola", [LINK])])])))).toBe("hola");
  });
});

describe("block and list joins", () => {
  it("derives nested mixed lists with one newline and no numeric markers", () => {
    const description = envelope(
      doc([
        paragraph([text("Intro")]),
        bulletList([
          listItem([
            paragraph([text("Item 1")]),
            bulletList([listItem([paragraph([text("Nested")])])]),
          ]),
        ]),
        orderedList(
          [listItem([paragraph([text("First")])]), listItem([paragraph([text("Second")])])],
          5,
        ),
      ]),
    );
    expect(plain(description)).toBe("Intro\nItem 1\nNested\nFirst\nSecond");
  });

  it("ignores ordered-list start numbers", () => {
    expect(plain(envelope(doc([orderedList([listItem([paragraph([text("only")])])], 7)])))).toBe("only");
  });
});

describe("whole-tree validation before derivation", () => {
  const invalid: Array<[string, unknown]> = [
    ["unknown version", { schema_version: 2, document: doc([paragraph()]) }],
    ["missing document", { schema_version: 1 }],
    ["null document", { schema_version: 1, document: null }],
    ["empty doc", envelope(doc([]))],
    ["invalid last node", envelope(doc([paragraph([text("ok")]), { type: "heading" }]))],
    ["invalid last mark", envelope(doc([paragraph([text("ok", [BOLD, { type: "strike" }])])]))],
  ];

  it.each(invalid)("rejects %s without partial output", (_name, description) => {
    expect(() => deriveDraftDescriptionPlain(description)).toThrow(ZodError);
  });

  it("rejects depth 17 and node 2001 before deriving", () => {
    expect(() => deriveDraftDescriptionPlain(nested(7, paragraph([text("x")])))).toThrow(ZodError);
    const at2001 = envelope(doc(Array.from({ length: 2000 }, () => paragraph())));
    expect(() => deriveDraftDescriptionPlain(at2001)).toThrow(ZodError);
  });

  it("preserves and does not clone or mutate the input", () => {
    const description = envelope(doc([paragraph([text("hola")])]));
    const snapshot = structuredClone(description);
    deepFreeze(description);
    expect(deriveDraftDescriptionPlain(description)).toBe("hola");
    expect(description).toStrictEqual(snapshot);
  });
});

describe("plain UTF-8 byte budget", () => {
  it("accepts exactly 65536 ASCII bytes and rejects 65537", () => {
    expect(DRAFT_DESCRIPTION_PLAIN_MAX_BYTES).toBe(65536);
    expect(bytesOf(plain(longDescription("a".repeat(65536))))).toBe(65536);
    expect(() => deriveDraftDescriptionPlain(longDescription("a".repeat(65537)))).toThrow(
      DraftDescriptionPlainBudgetError,
    );
  });

  it("measures UTF-8 bytes rather than UTF-16 units for multibyte text", () => {
    expect(bytesOf(plain(longDescription("é".repeat(32768))))).toBe(65536);
    expect(() => deriveDraftDescriptionPlain(longDescription("é".repeat(32769)))).toThrow(
      DraftDescriptionPlainBudgetError,
    );
    expect(bytesOf(plain(longDescription("\u{1F600}".repeat(16384))))).toBe(65536);
    expect(() => deriveDraftDescriptionPlain(longDescription("\u{1F600}".repeat(16385)))).toThrow(
      DraftDescriptionPlainBudgetError,
    );
  });

  it("counts inserted separators and never returns truncated output", () => {
    const atBoundary = envelope(
      doc([paragraph([text("é".repeat(16384))]), paragraph([text("é".repeat(16383))])]),
    );
    expect(bytesOf(plain(atBoundary))).toBe(65535);

    const over = envelope(
      doc([paragraph([text("é".repeat(16384))]), paragraph([text("é".repeat(16384))])]),
    );
    expect(() => deriveDraftDescriptionPlain(over)).toThrow(DraftDescriptionPlainBudgetError);
  });

  it("allows a large valid rich structure whose plain text is small", () => {
    const href = `https://example.com/${"a".repeat(2020)}`;
    const mark = { type: "link", attrs: { href, target: null, rel: null, class: null, title: null } };
    const many = envelope(
      doc(Array.from({ length: 500 }, () => paragraph([text("x", [mark])]))),
    );
    expect(plain(many)).toBe(`${"x\n".repeat(499)}x`);
  });
});
