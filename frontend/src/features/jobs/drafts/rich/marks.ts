import { z } from "zod";

/**
 * Strict rich mark validation for the private vacancy draft slice
 * (`docs/contracts/private-vacancy-drafts-v1.md` §5.2; canonical addendum §2,
 * §4). Marks are restricted to exactly `bold`, `italic`, `fontSizePreset` and
 * `link`.
 *
 * Zod-only: no React, no transport and no Tiptap/ProseMirror or editor-proof
 * import. Each schema validates one mark value and preserves the accepted
 * input: no coercion, defaulting, trimming, NFC, dedupe, sorting or reordering.
 * Tree placement/grammar, the canonical byte budget, the plain-text derivation
 * and the idempotency fingerprint belong to separate units, and a future
 * backend must revalidate all of these rules.
 */

/** Accepted `fontSizePreset.attrs.preset` literals. */
export const FONT_SIZE_PRESETS = ["small", "normal", "large"] as const;
/** Accepted `link.attrs.target` literals; `null` is also allowed. */
export const LINK_TARGETS = ["_blank", "_self"] as const;
/** Accepted `link.attrs.class` literal; `null` is also allowed. */
export const LINK_CLASSES = ["enlace-externo"] as const;
/** Accepted `link.attrs.rel` allowlist tokens. */
export const LINK_REL_TOKENS = ["noopener", "noreferrer", "nofollow"] as const;

/** Codepoint count: astral characters count as one, not two UTF-16 units. */
const countCodePoints = (value: string): number => [...value].length;

/**
 * Exact Unicode `White_Space` set, aligned with `drafts/text.ts`. Kept local
 * because this unit may not edit that reviewed module; U+FEFF is deliberately
 * absent from this set because it is not White_Space, and the shared draft text
 * policy keeps preserving it. `href` is the single field that additionally
 * rejects a raw U+FEFF, applied directly in `isValidHref` and nowhere else.
 */
const UNICODE_WHITE_SPACE = new Set<number>([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
]);

/** Raw C0/C1 controls plus DEL, rejected anywhere inside an `href`. */
const isControlCodePoint = (codePoint: number): boolean =>
  codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);

const HREF_MAX_CODE_POINTS = 2048;
const TITLE_MAX_CODE_POINTS = 200;
const REL_MAX_LENGTH = 128;
const MARKS_MAX_ITEMS = 4;

/**
 * A scheme followed by an explicit `//`. The WHATWG parser normalizes `https:/`
 * and `https:///` into a valid-looking URL, so the raw shape is checked first
 * and the parsed form never decides the prefix.
 */
const EXPLICIT_HOST_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/** Allowlist tokens separated by one or more ASCII U+0020, anchored both ends. */
const REL_PATTERN = /^(?:noopener|noreferrer|nofollow)(?:\x20+(?:noopener|noreferrer|nofollow))*$/;

/**
 * `href`: explicit absolute HTTP(S) with a nonempty authority and no
 * credentials, raw controls/whitespace/backslash/U+FEFF, or over-long value. The
 * string is only read: `URL` supplies validity/protocol/host/username/password
 * and its serialized form is never returned, so an accepted href is preserved
 * byte-for-byte and case-sensitively. Unicode hosts/paths and ordinary
 * punctuation stay valid. Rejecting a raw U+FEFF is an href-only exception: a
 * `title` and every other draft string keep preserving non-White_Space
 * characters, so no broader whitespace or format-character policy changes.
 */
function isValidHref(href: string): boolean {
  if (countCodePoints(href) > HREF_MAX_CODE_POINTS) return false;
  for (const character of href) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    if (
      codePoint === 0x5c ||
      codePoint === 0xfeff ||
      isControlCodePoint(codePoint) ||
      UNICODE_WHITE_SPACE.has(codePoint)
    ) {
      return false;
    }
  }

  const schemeMatch = EXPLICIT_HOST_SCHEME.exec(href);
  if (schemeMatch === null) return false;
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;

  const afterScheme = href.slice(schemeMatch[0].length);
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);
  if (authority === "" || authority.includes("@")) return false;

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname === "") return false;
  return parsed.username === "" && parsed.password === "";
}

/**
 * `rel`: null or one-or-more allowlist tokens separated by one or more ASCII
 * U+0020. No leading/trailing/empty gap, tab, newline or control; duplicates,
 * order and separator width are preserved because no dedupe or sort is applied.
 */
function isValidRel(rel: string): boolean {
  if (rel.length > REL_MAX_LENGTH) return false;
  const matched = REL_PATTERN.exec(rel);
  return matched !== null && matched[0] === rel;
}

const hrefSchema = z.string().superRefine((value, context) => {
  if (!isValidHref(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "href must be an explicit absolute HTTP(S) URL",
    });
  }
});

const titleSchema = z.string().superRefine((value, context) => {
  if (countCodePoints(value) > TITLE_MAX_CODE_POINTS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "title exceeds the codepoint limit" });
  }
});

const relSchema = z.string().superRefine((value, context) => {
  if (!isValidRel(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "rel must be an allowlisted token list" });
  }
});

/** `bold`: exactly a bare type. `attrs: null` or any extra key is rejected. */
export const draftBoldMarkSchema = z.object({ type: z.literal("bold") }).strict();
/** `italic`: exactly a bare type. `attrs: null` or any extra key is rejected. */
export const draftItalicMarkSchema = z.object({ type: z.literal("italic") }).strict();

/** `fontSizePreset`: a required strict attrs object with an exact preset. */
export const draftFontSizePresetMarkSchema = z
  .object({
    type: z.literal("fontSizePreset"),
    attrs: z.object({ preset: z.enum(FONT_SIZE_PRESETS) }).strict(),
  })
  .strict();

/** `link`: a required strict attrs object with all five contract keys. */
export const draftLinkMarkSchema = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: hrefSchema,
        target: z.enum(LINK_TARGETS).nullable(),
        rel: relSchema.nullable(),
        class: z.enum(LINK_CLASSES).nullable(),
        title: titleSchema.nullable(),
      })
      .strict(),
  })
  .strict();

/** One standalone rich mark of any of the four accepted types. */
export const draftRichMarkSchema = z.discriminatedUnion("type", [
  draftBoldMarkSchema,
  draftItalicMarkSchema,
  draftFontSizePresetMarkSchema,
  draftLinkMarkSchema,
]);

/**
 * A provided inline `marks` array (§5.2): empty is legal, at most four entries
 * and at most one entry per type — a second `fontSizePreset` with another
 * preset, or a second `link` with different attrs, is a duplicate. Submitted
 * order is preserved; no dedupe, sort or reorder. Array omission versus `[]`
 * stays a later tree-validator concern.
 */
export const draftProvidedMarksSchema = z
  .array(draftRichMarkSchema)
  .max(MARKS_MAX_ITEMS)
  .superRefine((marks, context) => {
    const seenTypes = new Set<string>();
    marks.forEach((mark, index) => {
      if (seenTypes.has(mark.type)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "duplicate mark type",
        });
      }
      seenTypes.add(mark.type);
    });
  });

/** One validated rich mark. */
export type DraftRichMark = z.output<typeof draftRichMarkSchema>;
/** A provided inline `marks` array. */
export type DraftProvidedMarks = z.output<typeof draftProvidedMarksSchema>;
