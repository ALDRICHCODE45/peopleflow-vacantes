import { cn } from "cn";
import { Fragment, type ReactNode } from "react";

import { draftRichDescriptionSchema } from "../rich/description";
import type {
  DraftRichBlockNode,
  DraftRichBulletListNode,
  DraftRichEnvelope,
  DraftRichInlineNode,
  DraftRichListItemNode,
  DraftRichOrderedListNode,
  DraftRichParagraphNode,
} from "../rich/grammar";
import type { DraftProvidedMarks, DraftRichMark } from "../rich/marks";

/**
 * Safe React renderer for the approved rich description of the final-step draft
 * preview.
 *
 * Validation ownership is explicit: `resolveDraftRichDescription` is the public
 * entry point and owns the *full* `draftRichDescriptionSchema` (structure,
 * marks, URLs, plain-text budget and canonical byte budget). Only the resulting
 * validated envelope reaches `DraftRichDescriptionContent`, whose prop type is
 * the public grammar envelope, so no exported component has to trust arbitrary
 * input. Rendering emits plain React elements: no `dangerouslySetInnerHTML`, no
 * attribute spreads and no mutation of the stored draft. A rejected or `null`
 * description never throws and never renders partial content.
 */

/** Validated envelope, or the two honest non-render outcomes of the resolver. */
export type DraftRichDescriptionResolution =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "ready"; description: DraftRichEnvelope };

/**
 * Validate a raw draft description with the complete approved schema and report
 * what the preview may render. Never throws and never mutates the input.
 */
export function resolveDraftRichDescription(input: unknown): DraftRichDescriptionResolution {
  const parsed = draftRichDescriptionSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  if (parsed.data === null) return { kind: "empty" };
  return { kind: "ready", description: parsed.data };
}

type MarkOf<Type extends DraftRichMark["type"]> = Extract<DraftRichMark, { type: Type }>;

/**
 * Existing high-contrast body-link treatment shared with the job detail view:
 * `text-foreground` with an always-visible underline, because the accent token
 * fails WCAG AA for body-sized link text. No raw color and no `text-primary`.
 */
const BODY_LINK_CLASS =
  "font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Explicit `fontSizePreset` presentation; the document base stays `text-base`. */
const FONT_SIZE_CLASS: Record<MarkOf<"fontSizePreset">["attrs"]["preset"], string> = {
  small: "text-sm",
  normal: "text-base",
  large: "text-lg",
};

/** Whether an already-validated `rel` carries the `noopener` link type. */
function hasNoopener(rel: string | null): boolean {
  return rel !== null && /(?:^|\x20)noopener(?:\x20|$)/.test(rel);
}

/**
 * Link `rel` for rendering only. An existing token list is preserved verbatim
 * and `noopener` is appended exactly once for `_blank`; the stored draft is
 * never rewritten, so no token is dropped or reordered.
 */
function resolveLinkRel(rel: string | null, target: MarkOf<"link">["attrs"]["target"]): string | undefined {
  if (target !== "_blank") return rel ?? undefined;
  if (hasNoopener(rel)) return rel ?? undefined;
  return rel === null ? "noopener" : `${rel} noopener`;
}

/** One validated `link` mark around its already-rendered inline content. */
function renderLink(attrs: MarkOf<"link">["attrs"], children: ReactNode): ReactNode {
  return (
    <a
      href={attrs.href}
      target={attrs.target ?? undefined}
      rel={resolveLinkRel(attrs.rel, attrs.target)}
      title={attrs.title ?? undefined}
      className={cn(BODY_LINK_CLASS, attrs.class)}
    >
      {children}
    </a>
  );
}

/**
 * One inline node. Marks wrap from the inside out in a fixed order
 * (`bold` → `italic` → `fontSizePreset` → `link`), so a combination is
 * deterministic regardless of the submitted mark order and keeps every mark's
 * semantics.
 */
function renderInlineNode(node: DraftRichInlineNode, key: number): ReactNode {
  let content: ReactNode = node.type === "hardBreak" ? <br /> : node.text;
  const marks: DraftProvidedMarks = node.marks ?? [];

  const bold = marks.find((mark): mark is MarkOf<"bold"> => mark.type === "bold");
  const italic = marks.find((mark): mark is MarkOf<"italic"> => mark.type === "italic");
  const fontSize = marks.find(
    (mark): mark is MarkOf<"fontSizePreset"> => mark.type === "fontSizePreset",
  );
  const link = marks.find((mark): mark is MarkOf<"link"> => mark.type === "link");

  if (bold !== undefined) content = <strong>{content}</strong>;
  if (italic !== undefined) content = <em>{content}</em>;
  if (fontSize !== undefined) {
    content = <span className={FONT_SIZE_CLASS[fontSize.attrs.preset]}>{content}</span>;
  }
  if (link !== undefined) content = renderLink(link.attrs, content);

  return <Fragment key={key}>{content}</Fragment>;
}

/**
 * One paragraph. An omitted or empty `content` is preserved visually with a
 * safe `<br />`, because Tailwind's reset collapses a truly empty paragraph.
 */
function renderParagraph(node: DraftRichParagraphNode, key: number): ReactNode {
  const inline = (node.content ?? []).map((child, index) => renderInlineNode(child, index));
  return <p key={key} className="whitespace-pre-wrap">{inline.length === 0 ? <br /> : inline}</p>;
}

/** One `listItem`; its first child is always a paragraph by the grammar. */
function renderListItem(node: DraftRichListItemNode, key: number): ReactNode {
  return (
    <li key={key}>
      {node.content.map((child, index) => renderBlock(child, index))}
    </li>
  );
}

/**
 * One bullet or ordered list. `list-disc`/`list-decimal` and padding are
 * explicit because the Tailwind reset removes native list markers; the ordered
 * list forwards its exact validated `start`.
 */
function renderList(
  node: DraftRichBulletListNode | DraftRichOrderedListNode,
  key: number,
): ReactNode {
  const items = node.content.map((item, index) => renderListItem(item, index));
  if (node.type === "bulletList") {
    return (
      <ul key={key} className="list-disc flex flex-col gap-1 pl-6">
        {items}
      </ul>
    );
  }
  return (
    <ol key={key} start={node.attrs.start} className="list-decimal flex flex-col gap-1 pl-6">
      {items}
    </ol>
  );
}

/** One validated block node; unknown input would render nothing, never throw. */
function renderBlock(node: DraftRichBlockNode, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return renderParagraph(node, key);
    case "bulletList":
    case "orderedList":
      return renderList(node, key);
    default:
      return null;
  }
}

export type DraftRichDescriptionContentProps = {
  /** Envelope produced by `resolveDraftRichDescription`; already validated. */
  description: DraftRichEnvelope;
};

/**
 * Approved rich content as ordinary React nodes. The base typography matches
 * the existing preview description block.
 */
export function DraftRichDescriptionContent({ description }: DraftRichDescriptionContentProps) {
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
      {description.document.content.map((node, index) => renderBlock(node, index))}
    </div>
  );
}
