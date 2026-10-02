/**
 * Safe, local-only rich-text model for the enriched create-vacancy prototype: it
 * returns plain strings and plain data only, never markup or an element escape hatch.
 */

/** A selection inside the plain value, in the textarea's own coordinates. */
export type RichTextRange = { start: number; end: number };

/** The next value plus the selection the caller should restore. */
export type RichTextEdit = { value: string; selection: RichTextRange };

/** One inline fragment of parsed content. */
export type RichTextInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string | null };

/** One parsed block: a paragraph, or a list of inline fragments. */
export type RichTextBlock =
  | { kind: "paragraph"; spans: RichTextInline[] }
  | { kind: "bullet-list"; items: RichTextInline[][] }
  | { kind: "numbered-list"; items: RichTextInline[][] };

const BOLD_MARKER = "**";
const ITALIC_MARKER = "*";
const BULLET_PREFIX = "- ";
const NUMBERED_SUFFIX = ". ";
const BOLD_PLACEHOLDER = "texto en negrita";
const ITALIC_PLACEHOLDER = "texto en cursiva";
/** Label used when a link is applied with nothing selected. */
export const LINK_PLACEHOLDER = "texto del enlace";

const BULLET_LINE = /^-\s+/u;
const NUMBERED_LINE = /^\d+\.\s+/u;
/**
 * The one link-destination grammar, shared by the inline token parser and the
 * URL sanitizer: no whitespace and no bare parentheses, plus a single balanced
 * parenthesized group. Sharing the source keeps acceptance and re-parsing in
 * step, so a destination the sanitizer accepts can always be read back out of
 * the token `applyLink` wrote.
 */
const DESTINATION_SOURCE = "(?:[^()\\s]|\\([^()]*\\))*";
const DESTINATION = new RegExp(`^(?:${DESTINATION_SOURCE})$`, "u");
const INLINE = new RegExp(
  `\\[([^\\]]*)\\]\\((${DESTINATION_SOURCE})\\)|\\*\\*([^*]+)\\*\\*|\\*([^*\\n]+)\\*`,
  "gu",
);
const SAFE_SCHEME = /^(https?):\/\//iu;
/**
 * A reachable host: dot-separated domain labels, or a bracketed IPv6 literal.
 * WHATWG parsing accepts punctuation-only authorities (`https://)` yields the
 * hostname `)`), so the parsed host is checked against this structural shape.
 */
const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const SAFE_HOST = new RegExp(
  `^(?:\\[[0-9a-f:.]+\\]|${HOST_LABEL}(?:\\.${HOST_LABEL})*)$`,
  "iu",
);
/** Underscore emphasis only at non-word boundaries, so identifiers survive. */
const UNDERSCORE_BOLD = /(?<![\p{L}\p{N}])__([^_\n]+)__(?![\p{L}\p{N}])/gu;
const UNDERSCORE_ITALIC = /(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu;

/** Clamps a DOM range into the current value and orders its ends. */
function normalizeRange(value: string, range: RichTextRange): RichTextRange {
  const limit = value.length;
  const start = Math.min(Math.max(Math.trunc(range.start), 0), limit);
  const end = Math.min(Math.max(Math.trunc(range.end), 0), limit);
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Accepts a link only when it carries an http or https scheme, no whitespace or
 * quote characters, a destination the link token grammar can carry, and a
 * structurally parseable host. javascript, data, and mailto addresses,
 * schemeless values, scheme-only or punctuation-only authorities, and
 * destinations with unmatched or nested parentheses all return null, so no
 * unreachable link and no unrepresentable token can be stored. The returned
 * value keeps the original lexical address and only lowercases the scheme.
 */
export function sanitizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const scheme = SAFE_SCHEME.exec(trimmed);
  if (scheme === null) return null;

  const address = trimmed.slice(scheme[0].length);
  const unsafe = /\s/u.test(address) || /[<>"']/u.test(trimmed);
  if (address === "" || unsafe || !DESTINATION.test(address)) return null;

  const normalized = `${scheme[1].toLowerCase()}://${address}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (!SAFE_HOST.test(parsed.hostname)) return null;

  return normalized;
}

/** Splits one line into inline fragments. Unknown syntax stays literal text. */
function parseInline(value: string): RichTextInline[] {
  const spans: RichTextInline[] = [];
  let cursor = 0;

  for (const match of value.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) spans.push({ kind: "text", text: value.slice(cursor, index) });

    const [full, linkText, href, bold, italic] = match;
    if (linkText !== undefined) {
      spans.push({ kind: "link", text: linkText, href: sanitizeLinkUrl(href) });
    } else if (bold !== undefined) spans.push({ kind: "bold", text: bold });
    else if (italic !== undefined) spans.push({ kind: "italic", text: italic });
    cursor = index + full.length;
  }

  if (cursor < value.length) spans.push({ kind: "text", text: value.slice(cursor) });
  return spans;
}

/**
 * Parses the plain value into blocks. Markup-looking text stays literal text
 * because this parser has no markup mode, and a blank line closes the block.
 */
export function parseRichText(value: string): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  let open: RichTextBlock | null = null;

  for (const line of value.split("\n")) {
    if (line.trim() === "") {
      open = null;
      continue;
    }

    // Consecutive items of the same kind extend the block that is open.
    if (BULLET_LINE.test(line)) {
      const item = parseInline(line.replace(BULLET_LINE, ""));
      if (open !== null && open.kind === "bullet-list") open.items.push(item);
      else blocks.push((open = { kind: "bullet-list", items: [item] }));
      continue;
    }

    if (NUMBERED_LINE.test(line)) {
      const item = parseInline(line.replace(NUMBERED_LINE, ""));
      if (open !== null && open.kind === "numbered-list") open.items.push(item);
      else blocks.push((open = { kind: "numbered-list", items: [item] }));
      continue;
    }

    open = { kind: "paragraph", spans: parseInline(line) };
    blocks.push(open);
  }

  return blocks;
}

/** Flattens one block's inline fragments into their readable text. */
function inlineToText(spans: RichTextInline[]): string {
  return spans.map((span) => span.text).join("");
}

/**
 * Removes the formatting markers the token model could not resolve, so a
 * malformed or surplus marker can never reach a public surface: a leftover link
 * keeps only its label, and stray bold/italic/underscore markers disappear.
 */
function neutralizeMarkers(text: string): string {
  return text
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)?/gu, "$1")
    .replace(UNDERSCORE_BOLD, "$1")
    .replace(UNDERSCORE_ITALIC, "$1")
    .replace(/\*+/gu, "");
}

/**
 * Deterministic plain-text projection of a formatted value: supported tokens and
 * links resolve to their readable text, real line breaks stay line breaks, and
 * ordinary punctuation such as `(ver requisitos)`, `100%`, or `C++` is
 * untouched. This is the single normalizer every public summary is built on.
 */
export function toPlainText(value: string): string {
  const text = parseRichText(value)
    .map((block) =>
      block.kind === "paragraph"
        ? inlineToText(block.spans)
        : block.items.map(inlineToText).join("\n"),
    )
    .join("\n");

  return neutralizeMarkers(text);
}

/**
 * Wraps the selection in a marker, keeping every unselected character. With
 * nothing selected it inserts a readable placeholder, spaced away from the
 * neighbouring word so the raw value never reads as one glued word.
 */
function wrapSelection(value: string, range: RichTextRange, marker: string, placeholder: string): RichTextEdit {
  const { start, end } = normalizeRange(value, range);
  if (start !== end) {
    const label = value.slice(start, end);
    const from = start + marker.length;
    return {
      value: `${value.slice(0, start)}${marker}${label}${marker}${value.slice(end)}`,
      selection: { start: from, end: from + label.length },
    };
  }

  const lead = start > 0 && !/\s/u.test(value.charAt(start - 1)) ? " " : "";
  const trail = start < value.length && !/\s/u.test(value.charAt(start)) ? " " : "";
  const from = start + lead.length + marker.length;
  const body = `${lead}${marker}${placeholder}${marker}${trail}`;
  return {
    value: `${value.slice(0, start)}${body}${value.slice(start)}`,
    selection: { start: from, end: from + placeholder.length },
  };
}

/** Rewrites only the lines the range touches and reports their new span. */
function transformTouchedLines(value: string, range: RichTextRange, transform: (line: string) => string): RichTextEdit {
  const { start, end } = normalizeRange(value, range);
  const out: string[] = [];
  let source = 0;
  let target = 0;
  let selectionStart = -1;
  let selectionEnd = 0;

  for (const line of value.split("\n")) {
    const lineStart = source;
    const lineEnd = lineStart + line.length;
    source = lineEnd + 1;

    const touched =
      start === end
        ? start >= lineStart && start <= lineEnd
        : start < lineEnd + 1 && end > lineStart;
    const next = touched ? transform(line) : line;

    if (touched) {
      if (selectionStart === -1) selectionStart = target;
      selectionEnd = target + next.length;
    }

    out.push(next);
    target += next.length + 1;
  }

  const selection = { start: selectionStart === -1 ? 0 : selectionStart, end: selectionEnd };
  return { value: out.join("\n"), selection };
}

/** Bolds the selected text, or inserts a placeholder when nothing is selected. */
export function applyBold(value: string, range: RichTextRange): RichTextEdit {
  return wrapSelection(value, range, BOLD_MARKER, BOLD_PLACEHOLDER);
}

/** Italicizes the selected text, or inserts a placeholder. */
export function applyItalic(value: string, range: RichTextRange): RichTextEdit {
  return wrapSelection(value, range, ITALIC_MARKER, ITALIC_PLACEHOLDER);
}

/** Marks every touched line as a bullet item, leaving marked lines untouched. */
export function applyBulletList(value: string, range: RichTextRange): RichTextEdit {
  const bullet = (line: string) =>
    line.startsWith(BULLET_PREFIX) ? line : `${BULLET_PREFIX}${line}`;
  return transformTouchedLines(value, range, bullet);
}

/** Numbers every touched line from one, leaving numbered lines untouched. */
export function applyNumberedList(value: string, range: RichTextRange): RichTextEdit {
  let counter = 0;
  return transformTouchedLines(value, range, (line) => {
    counter += 1;
    return NUMBERED_LINE.test(line) ? line : `${counter}${NUMBERED_SUFFIX}${line}`;
  });
}

/**
 * Wraps the selection in a link token. An unsafe address changes nothing at all,
 * so no unreachable link can ever be written into the plain value.
 */
export function applyLink(value: string, range: RichTextRange, rawUrl: string): RichTextEdit {
  const { start, end } = normalizeRange(value, range);
  const href = sanitizeLinkUrl(rawUrl);
  if (href === null) return { value, selection: { start, end } };

  const label = start === end ? LINK_PLACEHOLDER : value.slice(start, end);
  const link = `[${label}](${href})`;
  return {
    value: `${value.slice(0, start)}${link}${value.slice(end)}`,
    selection: { start: start + 1, end: start + 1 + label.length },
  };
}
