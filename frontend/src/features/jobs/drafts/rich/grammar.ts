import { z } from "zod";
import { draftProvidedMarksSchema, type DraftProvidedMarks } from "./marks";

/**
 * STRUCTURAL-ONLY restricted rich-description validation
 * (`docs/contracts/private-vacancy-drafts-v1.md` §5.1-§5.2).
 *
 * This module checks the JSON *shape and grammar* of `description` only. It is
 * deliberately not a byte-complete validator: it does not derive plain text,
 * compute the canonical-JSON byte budget or fingerprint, detect raw JSON
 * duplicate keys or original numeric lexemes, or apply any surrogate/format
 * policy. A backend remains authoritative for those concerns.
 *
 * Marks are delegated to the approved `./marks` schemas (read-only reuse).
 * Traversal is iterative and bounded: no `z.lazy`, no recursive descent and no
 * eager child fan-out, so depth (`doc` = 1) and node limits are enforced before
 * unbounded work. Node counting excludes marks.
 */

/** Maximum accepted tree depth; `doc` is depth 1 and inline nodes count. */
export const RICH_DESCRIPTION_MAX_DEPTH = 16;
/** Maximum accepted node count; marks are not nodes. */
export const RICH_DESCRIPTION_MAX_NODES = 2000;
/** Inclusive `orderedList.attrs.start` lower bound. */
export const ORDERED_LIST_START_MIN = 1;
/** Inclusive `orderedList.attrs.start` upper bound. */
export const ORDERED_LIST_START_MAX = 2147483647;

/** A `text` inline node with non-empty `text` and optional approved marks. */
export type DraftRichTextNode = { type: "text"; text: string; marks?: DraftProvidedMarks };
/** A `hardBreak` inline node with no text/content/attrs and optional marks. */
export type DraftRichHardBreakNode = { type: "hardBreak"; marks?: DraftProvidedMarks };
/** Inline nodes accepted inside a `paragraph`. */
export type DraftRichInlineNode = DraftRichTextNode | DraftRichHardBreakNode;
/** A `paragraph`; content is optional (`[]` and omission are preserved). */
export type DraftRichParagraphNode = { type: "paragraph"; content?: DraftRichInlineNode[] };
/** A `bulletList` requiring at least one `listItem`. */
export type DraftRichBulletListNode = { type: "bulletList"; content: DraftRichListItemNode[] };
/** An `orderedList` with complete strict attrs and at least one `listItem`. */
export type DraftRichOrderedListNode = {
  type: "orderedList";
  attrs: { start: number; type: null };
  content: DraftRichListItemNode[];
};
/** Block nodes accepted at the root and as `listItem` tails. */
export type DraftRichBlockNode =
  | DraftRichParagraphNode
  | DraftRichBulletListNode
  | DraftRichOrderedListNode;
/** A `listItem` starting with a `paragraph`, then paragraphs/lists. */
export type DraftRichListItemNode = { type: "listItem"; content: DraftRichBlockNode[] };
/** The restricted root document node; it cannot be nested. */
export type DraftRichDocNode = { type: "doc"; content: DraftRichBlockNode[] };
/** A non-null description envelope with the numeric API schema version. */
export type DraftRichEnvelope = { schema_version: 1; document: DraftRichDocNode };
/** `description`: `null` or a strict versioned envelope. */
export type DraftRichDescription = null | DraftRichEnvelope;

const DOC_KEYS: readonly string[] = ["type", "content"];
const PARAGRAPH_KEYS: readonly string[] = ["type", "content"];
const TEXT_KEYS: readonly string[] = ["type", "text", "marks"];
const HARD_BREAK_KEYS: readonly string[] = ["type", "marks"];
const BULLET_LIST_KEYS: readonly string[] = ["type", "content"];
const ORDERED_LIST_KEYS: readonly string[] = ["type", "attrs", "content"];
const LIST_ITEM_KEYS: readonly string[] = ["type", "content"];
const ORDERED_LIST_ATTR_KEYS: readonly string[] = ["start", "type"];

const MAX_MARKS_PER_INLINE_NODE = 4;

/** Child type acceptance for one parent; `firstType` pins index 0. */
interface ChildRule {
  readonly types: ReadonlySet<string>;
  readonly firstType?: string;
}

const BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "bulletList", "orderedList"]);
const INLINE_TYPES: ReadonlySet<string> = new Set(["text", "hardBreak"]);
const LIST_ITEM_TYPES: ReadonlySet<string> = new Set(["listItem"]);

const DOC_CHILD_RULE: ChildRule = { types: BLOCK_TYPES };
const INLINE_CHILD_RULE: ChildRule = { types: INLINE_TYPES };
const LIST_ITEM_CHILD_RULE: ChildRule = { types: LIST_ITEM_TYPES };
const LIST_ITEM_BODY_RULE: ChildRule = { types: BLOCK_TYPES, firstType: "paragraph" };

/** One inspected node: bounded child reference plus how its children are accepted. */
interface NodeInspection {
  readonly children: readonly unknown[] | null;
  readonly rule: ChildRule | null;
}

/** A cursor frame: at most one frame per open level, never a child fan-out. */
interface TraversalFrame {
  readonly children: readonly unknown[];
  readonly rule: ChildRule;
  readonly depth: number;
  index: number;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value) && value.length > 0;

const hasOnlyKeys = (node: Record<string, unknown>, allowed: readonly string[]): boolean => {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
};

/** Bounded guard before delegating the deep check to the approved mark schema. */
const areInlineMarksValid = (marks: unknown): boolean => {
  if (marks === undefined) return true;
  if (!Array.isArray(marks) || marks.length > MAX_MARKS_PER_INLINE_NODE) return false;
  return draftProvidedMarksSchema.safeParse(marks).success;
};

const areOrderedListAttrsValid = (attrs: unknown): boolean => {
  if (!isPlainRecord(attrs)) return false;
  if (!hasOnlyKeys(attrs, ORDERED_LIST_ATTR_KEYS)) return false;
  const start = attrs.start;
  if (
    typeof start !== "number" ||
    !Number.isInteger(start) ||
    start < ORDERED_LIST_START_MIN ||
    start > ORDERED_LIST_START_MAX
  ) {
    return false;
  }
  // `type` is required and exactly null; a missing key yields undefined and rejects.
  return attrs.type === null;
};

/**
 * Inspect one node in isolation. Returns `null` for any shape violation.
 * No children are iterated here, so the child array reference is all that is kept.
 */
function inspectNode(node: Record<string, unknown>, depth: number): NodeInspection | null {
  if (depth > RICH_DESCRIPTION_MAX_DEPTH) return null;
  switch (node.type) {
    case "doc": {
      if (!hasOnlyKeys(node, DOC_KEYS) || !isNonEmptyArray(node.content)) return null;
      return { children: node.content, rule: DOC_CHILD_RULE };
    }
    case "paragraph": {
      if (!hasOnlyKeys(node, PARAGRAPH_KEYS)) return null;
      if (node.content === undefined) return { children: null, rule: null };
      if (!Array.isArray(node.content)) return null;
      return { children: node.content, rule: INLINE_CHILD_RULE };
    }
    case "text": {
      if (!hasOnlyKeys(node, TEXT_KEYS)) return null;
      if (typeof node.text !== "string" || node.text.length === 0) return null;
      if (!areInlineMarksValid(node.marks)) return null;
      return { children: null, rule: null };
    }
    case "hardBreak": {
      if (!hasOnlyKeys(node, HARD_BREAK_KEYS)) return null;
      if (!areInlineMarksValid(node.marks)) return null;
      return { children: null, rule: null };
    }
    case "bulletList": {
      if (!hasOnlyKeys(node, BULLET_LIST_KEYS) || !isNonEmptyArray(node.content)) return null;
      return { children: node.content, rule: LIST_ITEM_CHILD_RULE };
    }
    case "orderedList": {
      if (!hasOnlyKeys(node, ORDERED_LIST_KEYS) || !areOrderedListAttrsValid(node.attrs)) return null;
      if (!isNonEmptyArray(node.content)) return null;
      return { children: node.content, rule: LIST_ITEM_CHILD_RULE };
    }
    case "listItem": {
      if (!hasOnlyKeys(node, LIST_ITEM_KEYS) || !isNonEmptyArray(node.content)) return null;
      const first = node.content[0];
      if (!isPlainRecord(first) || first.type !== "paragraph") return null;
      return { children: node.content, rule: LIST_ITEM_BODY_RULE };
    }
    default:
      return null;
  }
}

/**
 * Reports whether `value` is a structurally valid restricted document.
 *
 * The traversal uses an explicit cursor stack: children are never spread or
 * pushed in bulk, so a huge `content` array or a cyclic object cannot cause
 * unbounded allocation before the depth/node limits reject it. Marks are not
 * counted and are validated by the approved mark schema.
 */
export function isDraftRichDocumentStructure(value: unknown): value is DraftRichDocNode {
  if (!isPlainRecord(value) || value.type !== "doc") return false;
  const root = inspectNode(value, 1);
  if (root === null) return false;

  let nodeCount = 1;
  const stack: TraversalFrame[] = [];
  if (root.children !== null && root.rule !== null && root.children.length > 0) {
    stack.push({ children: root.children, rule: root.rule, depth: 2, index: 0 });
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.children.length) {
      stack.pop();
      continue;
    }
    const index = frame.index;
    frame.index += 1;
    const child = frame.children[index];
    if (!isPlainRecord(child) || typeof child.type !== "string") return false;
    if (!frame.rule.types.has(child.type)) return false;
    if (frame.rule.firstType !== undefined && index === 0 && child.type !== frame.rule.firstType) {
      return false;
    }
    const inspection = inspectNode(child, frame.depth);
    if (inspection === null) return false;
    nodeCount += 1;
    if (nodeCount > RICH_DESCRIPTION_MAX_NODES) return false;
    if (inspection.children !== null && inspection.rule !== null && inspection.children.length > 0) {
      stack.push({
        children: inspection.children,
        rule: inspection.rule,
        depth: frame.depth + 1,
        index: 0,
      });
    }
  }
  return true;
}

/** Structural-only predicate wrapped as a typed Zod schema. */
export const draftRichDocumentStructureSchema = z.custom<DraftRichDocNode>(
  (value) => isDraftRichDocumentStructure(value),
  { message: "invalid restricted rich document structure" },
);

/** Strict non-null envelope: `{ schema_version: 1, document }`. */
export const draftRichDescriptionEnvelopeStructureSchema = z
  .object({
    schema_version: z.literal(1),
    document: draftRichDocumentStructureSchema,
  })
  .strict();

/** `description` structure: `null`, or the strict versioned envelope. */
export const draftRichDescriptionStructureSchema = z.union([
  z.null(),
  draftRichDescriptionEnvelopeStructureSchema,
]);
