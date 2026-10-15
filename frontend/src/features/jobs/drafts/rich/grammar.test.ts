import { describe, expect, it } from "vitest";
import {
  draftRichDescriptionStructureSchema,
  isDraftRichDocumentStructure,
  ORDERED_LIST_START_MAX,
  ORDERED_LIST_START_MIN,
  RICH_DESCRIPTION_MAX_DEPTH,
  RICH_DESCRIPTION_MAX_NODES,
} from "./grammar";

/** Structural-only validation is being exercised; no byte/plain/hash claims. */
const parses = (input: unknown): boolean =>
  draftRichDescriptionStructureSchema.safeParse(input).success;
const parse = (input: unknown): unknown => draftRichDescriptionStructureSchema.parse(input);

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

const oneItem = (): unknown[] => [listItem([paragraph([text("item")])])];
const itemIn = (document: Record<string, unknown>): Record<string, unknown> => document;

const BOLD = { type: "bold" } as const;
const ITALIC = { type: "italic" } as const;
const SIZE = { type: "fontSizePreset", attrs: { preset: "normal" } } as const;
const LINK = {
  type: "link",
  attrs: {
    href: "https://example.com/a",
    target: "_blank",
    rel: "noopener",
    class: null,
    title: null,
  },
} as const;

/** Iterative builder: `wraps` bulletList/listItem/paragraph triples around a leaf. */
const nested = (wraps: number, leaf: Record<string, unknown>): Record<string, unknown> => {
  let block = leaf;
  for (let i = 0; i < wraps; i += 1) {
    block = bulletList([listItem([paragraph(), block])]);
  }
  return envelope(doc([block]));
};

describe("structural limits", () => {
  it("pins the contract depth, node and start bounds", () => {
    expect(RICH_DESCRIPTION_MAX_DEPTH).toBe(16);
    expect(RICH_DESCRIPTION_MAX_NODES).toBe(2000);
    expect(ORDERED_LIST_START_MIN).toBe(1);
    expect(ORDERED_LIST_START_MAX).toBe(2147483647);
  });
});

describe("description envelope", () => {
  it("accepts null and rejects undefined or other non-objects", () => {
    expect(parse(null)).toBeNull();
    for (const bad of [undefined, 0, "doc", true, []]) {
      expect(parses(bad)).toBe(false);
    }
  });

  it("requires a strict versioned envelope", () => {
    const document = doc([paragraph()]);
    expect(parse(envelope(document))).toStrictEqual({ schema_version: 1, document });
    for (const bad of [
      {},
      { document },
      { schema_version: 1 },
      { schema_version: 1, document, extra: true },
      { schema_version: 0, document },
      { schema_version: 2, document },
      { schema_version: "1", document },
      { schema_version: 1, document: null },
      { schema_version: 1, document: [] },
      { schema_version: 1, document: "doc" },
    ]) {
      expect(parses(bad)).toBe(false);
    }
  });

  it("exposes an iterative document predicate", () => {
    const document = doc([paragraph([text("x")])]);
    expect(isDraftRichDocumentStructure(document)).toBe(true);
    expect(isDraftRichDocumentStructure(envelope(document))).toBe(false);
  });
});

describe("accepted restricted grammar", () => {
  it("accepts every contract node kind, including marked inline nodes", () => {
    const document = doc([
      paragraph([text("plain"), hardBreak(), text("marked", [BOLD, ITALIC, SIZE, LINK])]),
      bulletList([listItem([paragraph([text("bullet")])])]),
      orderedList([listItem([paragraph([text("ordered")])])]),
    ]);
    expect(parses(envelope(document))).toBe(true);
  });

  it("accepts an empty paragraph, empty inline content and empty list items starts", () => {
    expect(parses(envelope(doc([paragraph()])))).toBe(true);
    expect(parses(envelope(doc([paragraph([])])))).toBe(true);
    expect(parses(envelope(doc([bulletList([listItem([paragraph()])])])))).toBe(true);
    expect(parses(envelope(doc([orderedList([listItem([paragraph()])])])))).toBe(true);
  });

  it("accepts the full four-mark set on a hardBreak", () => {
    expect(parses(envelope(doc([paragraph([hardBreak([BOLD, ITALIC, SIZE, LINK])])])))).toBe(true);
  });
});

describe("rejected node grammar", () => {
  const cases: Array<[string, unknown]> = [
    ["nested doc", doc([doc([paragraph()])])],
    ["unknown node", doc([{ type: "heading" }])],
    ["doc child text", doc([text("x")])],
    ["paragraph child paragraph", doc([paragraph([paragraph()])])],
    ["paragraph child list", doc([paragraph([bulletList(oneItem())])])],
    ["empty doc", doc([])],
    ["doc content object", { type: "doc", content: {} }],
    ["unknown key on doc", { type: "doc", content: [paragraph()], extra: 1 }],
    ["unknown key on paragraph", { type: "paragraph", extra: 1 }],
    ["paragraph attrs null", { type: "paragraph", attrs: null }],
    ["paragraph marks", { type: "paragraph", marks: [] }],
    ["unknown key on text", { type: "text", text: "x", extra: 1 }],
    ["text attrs", { type: "text", text: "x", attrs: null }],
    ["text content", { type: "text", text: "x", content: [] }],
    ["empty text", doc([paragraph([text("")])])],
    ["hardBreak text", { type: "hardBreak", text: "x" }],
    ["hardBreak content", { type: "hardBreak", content: [] }],
    ["hardBreak attrs", { type: "hardBreak", attrs: null }],
    ["bulletList attrs", doc([{ type: "bulletList", attrs: {}, content: oneItem() }])],
    ["bulletList empty", doc([bulletList([])])],
    ["bulletList paragraph child", doc([bulletList([paragraph()])])],
    ["listItem empty", doc([bulletList([listItem([])])])],
    ["listItem list first", doc([bulletList([listItem([bulletList(oneItem())])])])],
    ["orderedList missing attrs", doc([{ type: "orderedList", content: oneItem() }])],
    ["orderedList attrs null", doc([{ type: "orderedList", attrs: null, content: oneItem() }])],
    [
      "orderedList extra attr",
      doc([{ type: "orderedList", attrs: { start: 1, type: null, extra: 1 }, content: oneItem() }]),
    ],
    ["orderedList missing type", doc([{ type: "orderedList", attrs: { start: 1 }, content: oneItem() }])],
    [
      "orderedList type string",
      doc([{ type: "orderedList", attrs: { start: 1, type: "1" }, content: oneItem() }]),
    ],
  ];

  it.each(cases)("rejects %s", (_name, document) => {
    expect(parses(envelope(document))).toBe(false);
    expect(isDraftRichDocumentStructure(document)).toBe(false);
  });

  it("rejects orderedList start values outside the integer bounds", () => {
    const withStart = (start: unknown): unknown =>
      envelope(doc([{ type: "orderedList", attrs: { start, type: null }, content: oneItem() }]));
    expect(parses(withStart(ORDERED_LIST_START_MIN))).toBe(true);
    expect(parses(withStart(ORDERED_LIST_START_MAX))).toBe(true);
    for (const bad of [
      0,
      -1,
      ORDERED_LIST_START_MAX + 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      null,
      undefined,
    ]) {
      expect(parses(withStart(bad))).toBe(false);
    }
    expect(parses(envelope(doc([{ type: "orderedList", attrs: { type: null }, content: oneItem() }])))).toBe(
      false,
    );
  });
});

describe("inline mark delegation", () => {
  it("rejects marks rejected by the approved mark schemas", () => {
    const invalidMarks: Array<[string, unknown]> = [
      ["unknown mark", [{ type: "strike" }]],
      ["bold attrs", [{ type: "bold", attrs: {} }]],
      ["bad preset", [{ type: "fontSizePreset", attrs: { preset: "huge" } }]],
      [
        "bad href",
        [
          {
            type: "link",
            attrs: { href: "javascript:alert(1)", target: null, rel: null, class: null, title: null },
          },
        ],
      ],
      ["duplicate type", [BOLD, BOLD]],
      ["too many", [BOLD, ITALIC, SIZE, LINK, BOLD]],
    ];
    for (const [, marks] of invalidMarks) {
      expect(parses(envelope(doc([paragraph([text("x", marks)])])))).toBe(false);
      expect(parses(envelope(doc([paragraph([hardBreak(marks)])])))).toBe(false);
    }
  });
});

describe("bounded depth and node budget", () => {
  it("accepts depth 16 and rejects depth 17", () => {
    expect(parses(nested(7, paragraph()))).toBe(true);
    expect(parses(nested(7, paragraph([text("x")])))).toBe(false);
  });

  it("accepts 2000 nodes and rejects 2001", () => {
    const withParagraphs = (count: number): unknown =>
      envelope(doc(Array.from({ length: count }, () => paragraph())));
    expect(parses(withParagraphs(RICH_DESCRIPTION_MAX_NODES - 1))).toBe(true);
    expect(parses(withParagraphs(RICH_DESCRIPTION_MAX_NODES))).toBe(false);
  });

  it("counts nodes independently of marks at the boundary", () => {
    const markedText = { type: "text", text: "m", marks: [BOLD, ITALIC, SIZE, LINK] };
    const at2000: unknown[] = [];
    for (let i = 0; i < 998; i += 1) at2000.push(paragraph([text("p")]));
    at2000.push(paragraph([text("a"), markedText]));
    expect(parses(envelope(doc(at2000)))).toBe(true);

    const at2001: unknown[] = [];
    for (let i = 0; i < 998; i += 1) at2001.push(paragraph([text("p")]));
    at2001.push(paragraph([text("a"), markedText, text("b")]));
    expect(parses(envelope(doc(at2001)))).toBe(false);
  });

  it("terminates an iteratively built very deep input without overflow", () => {
    const deep = nested(20000, paragraph());
    expect(() => parses(deep)).not.toThrow();
    expect(parses(deep)).toBe(false);
  });

  it("terminates a cyclic document by the limits", () => {
    const item: Record<string, unknown> = { type: "listItem", content: [paragraph()] };
    const list: Record<string, unknown> = { type: "bulletList" };
    list.content = [item];
    (item.content as unknown[]).push(list);
    const description = envelope(doc([list]));
    expect(() => parses(description)).not.toThrow();
    expect(parses(description)).toBe(false);
  });
});

describe("structure preservation", () => {
  it("preserves NFC-distinct strings and U+FEFF text without normalization", () => {
    const composed = "\u00e9";
    const decomposed = "e\u0301";
    const feff = "\uFEFFtext";
    const description = envelope(
      doc([paragraph([text(composed), text(decomposed), text(feff)])]),
    );
    expect(parse(description)).toStrictEqual(description);
    expect(composed).not.toBe(decomposed);
  });

  it("preserves marks omission versus an empty array", () => {
    const omitted = envelope(doc([paragraph([text("a")])]));
    const empty = envelope(doc([paragraph([text("a", [])])]));
    expect(parse(omitted)).toStrictEqual(omitted);
    expect(parse(empty)).toStrictEqual(empty);
    expect(parse(omitted)).not.toStrictEqual(parse(empty));
  });

  it("preserves paragraph content omission versus an empty array", () => {
    const omitted = envelope(doc([paragraph()]));
    const empty = envelope(doc([paragraph([])]));
    expect(parse(omitted)).toStrictEqual(omitted);
    expect(parse(empty)).toStrictEqual(empty);
    expect(parse(omitted)).not.toStrictEqual(parse(empty));
  });

  it("preserves array order across mixed blocks", () => {
    const description = envelope(
      doc([
        paragraph([text("first")]),
        bulletList([listItem([paragraph([text("second")])])]),
        paragraph([text("third")]),
      ]),
    );
    expect(parse(description)).toStrictEqual(description);
  });

  it("does not deep-clone the validated document", () => {
    const description = envelope(doc([paragraph([text("hola")])]));
    const output = draftRichDescriptionStructureSchema.parse(description);
    if (output === null) throw new Error("unreachable");
    expect(output.document).toBe(itemIn(description).document);
  });
});
