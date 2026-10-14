import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  draftBoldMarkSchema,
  draftFontSizePresetMarkSchema,
  draftItalicMarkSchema,
  draftLinkMarkSchema,
  draftProvidedMarksSchema,
  draftRichMarkSchema,
  FONT_SIZE_PRESETS,
  LINK_CLASSES,
  LINK_REL_TOKENS,
  LINK_TARGETS,
} from "./marks";

const ok = (schema: z.ZodTypeAny, input: unknown): boolean => schema.safeParse(input).success;
const out = (schema: z.ZodTypeAny, input: unknown): unknown => schema.parse(input);

/** U+1F600: one codepoint, two UTF-16 units. */
const ASTRAL = String.fromCodePoint(0x1f600);
const NBSP = "\u00a0";
const NEL = "\u0085";

const SAFE_HREF = "https://example.com/ok";
const SAFE_REL = "noopener noreferrer nofollow";

const linkAttrs = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  href: SAFE_HREF,
  target: "_blank",
  rel: SAFE_REL,
  class: null,
  title: null,
  ...overrides,
});
const link = (attrs: unknown) => ({ type: "link", attrs });
const safeLink = (overrides: Record<string, unknown> = {}) => link(linkAttrs(overrides));
const withoutAttr = (key: string): Record<string, unknown> => {
  const attrs = linkAttrs();
  delete attrs[key];
  return attrs;
};

const hrefBase = "https://example.com/";
const paddedHref = (count: number) => hrefBase + "a".repeat(count);

describe("rich mark catalogs", () => {
  it("pins the exact preset, target, class and rel allowlists", () => {
    expect(FONT_SIZE_PRESETS).toEqual(["small", "normal", "large"]);
    expect(LINK_TARGETS).toEqual(["_blank", "_self"]);
    expect(LINK_CLASSES).toEqual(["enlace-externo"]);
    expect(LINK_REL_TOKENS).toEqual(["noopener", "noreferrer", "nofollow"]);
  });
});

describe("standalone bold and italic schemas", () => {
  it("accepts exactly a bare type with no attrs", () => {
    expect(out(draftBoldMarkSchema, { type: "bold" })).toEqual({ type: "bold" });
    expect(out(draftItalicMarkSchema, { type: "italic" })).toEqual({ type: "italic" });
    expect(ok(draftRichMarkSchema, { type: "bold" })).toBe(true);
    expect(ok(draftRichMarkSchema, { type: "italic" })).toBe(true);
  });

  it("rejects attrs null, attrs {}, extra keys and unknown variants", () => {
    for (const bad of [
      { type: "bold", attrs: null },
      { type: "bold", attrs: {} },
      { type: "bold", text: "x" },
      { type: "bold", content: [] },
      { type: "bond" },
      { type: "Bold" },
      { type: "BOLD" },
    ]) {
      expect(ok(draftBoldMarkSchema, bad)).toBe(false);
      expect(ok(draftRichMarkSchema, bad)).toBe(false);
    }
    for (const bad of [
      { type: "italic", attrs: null },
      { type: "italic", attrs: {} },
      { type: "italic", text: "x" },
      { type: "italic", content: [] },
      { type: "Italic" },
    ]) {
      expect(ok(draftItalicMarkSchema, bad)).toBe(false);
      expect(ok(draftRichMarkSchema, bad)).toBe(false);
    }
  });
});

describe("standalone fontSizePreset schema", () => {
  it("accepts each label under a required strict attrs object", () => {
    for (const preset of FONT_SIZE_PRESETS) {
      const mark = { type: "fontSizePreset", attrs: { preset } };
      expect(out(draftFontSizePresetMarkSchema, mark)).toEqual(mark);
      expect(ok(draftRichMarkSchema, mark)).toBe(true);
    }
  });

  it("rejects missing/null attrs, unknown labels and extra keys", () => {
    for (const bad of [
      { type: "fontSizePreset" },
      { type: "fontSizePreset", attrs: null },
      { type: "fontSizePreset", attrs: {} },
      { type: "fontSizePreset", attrs: { preset: "huge" } },
      { type: "fontSizePreset", attrs: { preset: "Small" } },
      { type: "fontSizePreset", attrs: { preset: "" } },
      { type: "fontSizePreset", attrs: { preset: 1 } },
      { type: "fontSizePreset", attrs: { preset: "small", extra: true } },
      { type: "fontSizePreset", attrs: "small" },
    ]) {
      expect(ok(draftFontSizePresetMarkSchema, bad)).toBe(false);
      expect(ok(draftRichMarkSchema, bad)).toBe(false);
    }
  });
});

describe("link schema attribute completeness", () => {
  it("accepts the complete strict five-attribute link and preserves it exactly", () => {
    const mark = safeLink();
    expect(out(draftLinkMarkSchema, mark)).toEqual(mark);
    expect(ok(draftRichMarkSchema, mark)).toBe(true);
  });

  it("requires all five attrs", () => {
    for (const key of ["href", "target", "rel", "class", "title"]) {
      expect(ok(draftLinkMarkSchema, link(withoutAttr(key)))).toBe(false);
      expect(ok(draftRichMarkSchema, link(withoutAttr(key)))).toBe(false);
    }
  });

  it("rejects attrs null/absent, a non-object attrs and unknown attr keys", () => {
    for (const bad of [
      { type: "link" },
      { type: "link", attrs: null },
      { type: "link", attrs: SAFE_HREF },
      { type: "link", attrs: [] },
      { type: "link", attrs: linkAttrs({ extra: 1 }) },
      { type: "link", attrs: linkAttrs({ rel: undefined }) },
    ]) {
      expect(ok(draftLinkMarkSchema, bad)).toBe(false);
      expect(ok(draftRichMarkSchema, bad)).toBe(false);
    }
  });
});

describe("link href acceptance", () => {
  it("accepts explicit absolute http(s), mixed case, Unicode and punctuation", () => {
    for (const href of [
      "http://example.com",
      "https://example.com",
      "https://example.com/ok",
      "HTTPS://EXAMPLE.COM/Path?A=1#Frag",
      "https://münchen.example/straße?q=ñ",
      "https://example.com/a,b;c(d)e!f~g",
      "https://[2001:db8::1]:8443/path",
      "https://example.com/a@b",
      "https://example.com/?redirect=user@example.com",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ href })), href).toBe(true);
    }
  });

  it("preserves the href string with no trim, normalization or serialization", () => {
    const href = "HTTPS://EXAMPLE.COM/Path?A=1#Frag";
    expect((out(draftLinkMarkSchema, safeLink({ href })) as { attrs: { href: string } }).attrs.href).toBe(
      href,
    );
    const unicode = "https://münchen.example/straße?q=ñ";
    expect(
      (out(draftLinkMarkSchema, safeLink({ href: unicode })) as { attrs: { href: string } }).attrs.href,
    ).toBe(unicode);
  });

  it("rejects nonexplicit schemes, relative forms and WHATWG shortcuts", () => {
    for (const href of [
      "",
      "example.com",
      "/relative",
      "//example.com",
      "javascript:alert(1)",
      "data:text/html,alert(1)",
      "mailto:someone@example.com",
      "ftp://example.com",
      "https:/example.com",
      "https:///example.com",
      "https://",
      "http:/example.com",
      "https:example.com",
      "https://",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ href })), href).toBe(false);
    }
  });

  it("rejects credentials including an empty userinfo", () => {
    for (const href of [
      "https://user:pass@example.com/x",
      "https://user@example.com",
      "https://@example.com",
      "https://@example.com/x",
      "http://user:@example.com",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ href })), href).toBe(false);
    }
  });

  it("rejects raw backslash, controls and Unicode whitespace anywhere", () => {
    for (const href of [
      "https://ex.com\\path",
      "https://ex.com/\u0000",
      "https://ex.com/\n",
      "https://ex.com/\t",
      "https://ex.com/\r",
      "https://ex.com/\u007f",
      "https://ex.com/\u0085",
      "https://ex.com/\u009f",
      "https://exa mple.com",
      "https://ex.com/ ",
      " https://ex.com",
      "https://ex.com/\u00a0",
      "https://ex.com/\u3000",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ href })), JSON.stringify(href)).toBe(false);
    }
  });

  it.each([
    "\uFEFFhttps://example.com/x",
    "https://exa\uFEFFmple.com/x",
    "https://example.com/a\uFEFFb",
    "https://example.com/x\uFEFF",
  ])("rejects a raw U+FEFF anywhere in href: %j", (href) => {
    expect(ok(draftLinkMarkSchema, safeLink({ href }))).toBe(false);
  });

  it("bounds href at 2048 codepoints, counting astral characters as one", () => {
    expect(ok(draftLinkMarkSchema, safeLink({ href: paddedHref(2028) }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ href: paddedHref(2029) }))).toBe(false);
    expect(ok(draftLinkMarkSchema, safeLink({ href: hrefBase + ASTRAL.repeat(2028) }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ href: hrefBase + ASTRAL.repeat(2029) }))).toBe(false);
  });
});

describe("link target, class and title", () => {
  it("accepts the exact target allowlist plus null and rejects everything else", () => {
    for (const target of [...LINK_TARGETS, null]) {
      expect(ok(draftLinkMarkSchema, safeLink({ target })), String(target)).toBe(true);
    }
    for (const target of ["_top", "_parent", "blank", "", "_BLANK", " SELF "]) {
      expect(ok(draftLinkMarkSchema, safeLink({ target }))).toBe(false);
    }
  });

  it("accepts only null or the exact enlace-externo class", () => {
    for (const value of [...LINK_CLASSES, null]) {
      expect(ok(draftLinkMarkSchema, safeLink({ class: value }))).toBe(true);
    }
    for (const value of ["external", "Enlace-Externo", "ENLACE-EXTERNO", "", " enlace-externo "]) {
      expect(ok(draftLinkMarkSchema, safeLink({ class: value }))).toBe(false);
    }
  });

  it("accepts null or a preserved string up to 200 codepoints without trimming or NFC", () => {
    expect(ok(draftLinkMarkSchema, safeLink({ title: null }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: "" }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: "  " }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: `\t${NBSP}${NEL}` }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: "a".repeat(200) }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: "a".repeat(201) }))).toBe(false);
    expect(ok(draftLinkMarkSchema, safeLink({ title: ASTRAL.repeat(200) }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ title: ASTRAL.repeat(201) }))).toBe(false);

    const padded = `  ${NBSP}Titulo${NEL}  `;
    expect(
      (out(draftLinkMarkSchema, safeLink({ title: padded })) as { attrs: { title: string } }).attrs.title,
    ).toBe(padded);
    const decomposed = "e\u0301";
    expect(
      (out(draftLinkMarkSchema, safeLink({ title: decomposed })) as { attrs: { title: string } }).attrs
        .title,
    ).toBe(decomposed);
  });

  it("keeps U+FEFF in a title preserved, proving the href rule stays href-only", () => {
    const title = `a\uFEFFb`;
    expect(ok(draftLinkMarkSchema, safeLink({ title }))).toBe(true);
    expect(
      (out(draftLinkMarkSchema, safeLink({ title })) as { attrs: { title: string } }).attrs.title,
    ).toBe(title);
  });

  it("rejects non-string titles", () => {
    for (const title of [1, true, {}, []]) {
      expect(ok(draftLinkMarkSchema, safeLink({ title }))).toBe(false);
    }
  });
});

describe("link rel", () => {
  it("accepts null and every allowlist token", () => {
    expect(out(draftLinkMarkSchema, safeLink({ rel: null }))).toEqual(safeLink({ rel: null }));
    for (const token of LINK_REL_TOKENS) {
      expect(ok(draftLinkMarkSchema, safeLink({ rel: token })), token).toBe(true);
    }
  });

  it("preserves order, duplicates and separator spacing exactly", () => {
    for (const rel of [
      "noopener",
      "noreferrer",
      "nofollow",
      "noopener noreferrer nofollow",
      "nofollow noopener",
      "noopener  noreferrer",
      "noopener   noreferrer nofollow",
      "noopener noopener",
      "noreferrer noreferrer noreferrer",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ rel })), rel).toBe(true);
      expect(
        (out(draftLinkMarkSchema, safeLink({ rel })) as { attrs: { rel: string } }).attrs.rel,
      ).toBe(rel);
    }
  });

  it("rejects leading/trailing/empty gaps, tab, newline and controls", () => {
    for (const rel of [
      "",
      " ",
      " noopener",
      "noopener ",
      "noopener\tnoopener",
      "noopener\nnoopener",
      "noopener\rnoopener",
      "noopener\u0000noopener",
      "noopener\u00a0noopener",
      "noopener, noreferrer",
      "noopener;noreferrer",
    ]) {
      expect(ok(draftLinkMarkSchema, safeLink({ rel })), JSON.stringify(rel)).toBe(false);
    }
  });

  it("rejects unknown tokens and wrong case", () => {
    for (const rel of ["sponsored", "ugc", "NOOPENER", "Noopener", "noopener sponsored"]) {
      expect(ok(draftLinkMarkSchema, safeLink({ rel })), rel).toBe(false);
    }
  });

  it("bounds rel at 128 ASCII characters", () => {
    const boundary = `noopener${" ".repeat(112)}noopener`;
    expect(boundary).toHaveLength(128);
    expect(ok(draftLinkMarkSchema, safeLink({ rel: boundary }))).toBe(true);
    expect(ok(draftLinkMarkSchema, safeLink({ rel: `noopener${" ".repeat(113)}noopener` }))).toBe(
      false,
    );
    expect(ok(draftLinkMarkSchema, safeLink({ rel: "noopener".repeat(17) }))).toBe(false);
  });
});

describe("provided marks array schema", () => {
  it("accepts [] and preserves it", () => {
    expect(out(draftProvidedMarksSchema, [])).toEqual([]);
  });

  it("accepts all four ordered marks and preserves order and values", () => {
    const marks = [
      { type: "bold" },
      { type: "italic" },
      { type: "fontSizePreset", attrs: { preset: "large" } },
      safeLink(),
    ];
    expect(out(draftProvidedMarksSchema, marks)).toEqual(marks);
  });

  it("rejects a duplicate type even when preset or link attrs differ", () => {
    const duplicates = [
      [{ type: "bold" }, { type: "bold" }],
      [
        { type: "fontSizePreset", attrs: { preset: "small" } },
        { type: "fontSizePreset", attrs: { preset: "large" } },
      ],
      [safeLink(), safeLink({ href: "https://example.org/other" })],
      [{ type: "italic" }, { type: "italic" }],
    ];
    for (const marks of duplicates) {
      expect(ok(draftProvidedMarksSchema, marks), JSON.stringify(marks)).toBe(false);
    }
  });

  it("rejects more than four entries and unknown/duplicate mark types", () => {
    for (const marks of [
      [{ type: "bold" }, { type: "bold" }, { type: "bold" }, { type: "bold" }, { type: "bold" }],
      [{ type: "bold" }, { type: "italic" }, { type: "fontSizePreset", attrs: { preset: "small" } }, safeLink(), { type: "bold" }],
      [{ type: "underline" }],
      [{ type: "strike" }],
    ]) {
      expect(ok(draftProvidedMarksSchema, marks)).toBe(false);
    }
  });

  it("rejects null, undefined and every non-array value", () => {
    for (const whole of [null, undefined, "bold", 1, {}, { marks: [] }, true]) {
      expect(ok(draftProvidedMarksSchema, whole)).toBe(false);
    }
  });

  it("rejects an invalid mark anywhere in an otherwise valid array", () => {
    for (const bad of [
      { type: "bold", attrs: null },
      { type: "fontSizePreset", attrs: { preset: "huge" } },
      safeLink({ href: "javascript:alert(1)" }),
      safeLink({ rel: "sponsored" }),
      null,
    ]) {
      expect(ok(draftProvidedMarksSchema, [{ type: "bold" }, bad])).toBe(false);
    }
  });
});

describe("supplement-derived raw link marks", () => {
  it("accepts the approved safe five-attribute raw link and rejects the unsafe raws", () => {
    const supplementSafe = linkAttrs({ href: "https://example.com/ok" });
    expect(ok(draftLinkMarkSchema, link(supplementSafe))).toBe(true);

    const unsafe = [
      "javascript:alert(1)",
      "data:text/html,alert(1)",
      "https://user:pass@example.com/x",
    ];
    for (const href of unsafe) {
      expect(ok(draftLinkMarkSchema, link(linkAttrs({ href }))), href).toBe(false);
    }
  });
});
