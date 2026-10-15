import {
  draftRichDescriptionStructureSchema,
  type DraftRichBlockNode,
  type DraftRichDocNode,
  type DraftRichInlineNode,
  type DraftRichListItemNode,
} from "./grammar";

/**
 * Optional client-side plain-text derivation / prevalidation for the private
 * vacancy draft slice (`docs/contracts/private-vacancy-drafts-v1.md` §5.1-§5.2).
 *
 * This is not the authoritative server `description_plain`: the backend owns
 * that field. The function validates the *whole* nullable description with the
 * approved structural schema before deriving anything, so an invalid node or
 * mark can never yield partial text, and it never truncates. The measured
 * budget is the derived plain UTF-8 byte length, **not** the canonical rich-JSON
 * size, so a structurally valid document may pass here while still failing the
 * separate canonical-byte write acceptance. No trimming, Unicode normalization,
 * list markers or link URLs are added.
 */

/** Inclusive UTF-8 byte limit for the derived plain text. */
export const DRAFT_DESCRIPTION_PLAIN_MAX_BYTES = 65536;

/** Raised when the derived plain text exceeds the UTF-8 byte budget. */
export class DraftDescriptionPlainBudgetError extends Error {
  constructor() {
    super(`plain text exceeds ${DRAFT_DESCRIPTION_PLAIN_MAX_BYTES} UTF-8 bytes`);
    this.name = "DraftDescriptionPlainBudgetError";
  }
}

/** Any validated node that can appear inside an iterated frame's children. */
type TraversedNode =
  | DraftRichDocNode
  | DraftRichBlockNode
  | DraftRichListItemNode
  | DraftRichInlineNode;

/** One open level: its children plus how those children are joined. */
interface TraversalFrame {
  readonly children: readonly TraversedNode[];
  readonly newlineJoin: boolean;
  index: number;
}

const encodeBytes = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Flatten a validated document iteratively (depth ≤ 16, ≤ 2000 nodes).
 *
 * Paragraphs concatenate inline children; `hardBreak` emits a newline;
 * `doc`/list/`listItem` join child results with exactly one `\n`, including
 * empty children. Chunks are accumulated with an explicit cursor stack, so
 * there is no recursive descent and no per-parent fan-out join. The running
 * UTF-16 length (separators included) rejects oversized output *before* the
 * final join: every UTF-8 byte costs at least one UTF-16 unit, so units above
 * the limit imply bytes above it. The joined string is then measured for
 * real, covering astral characters and any surrogate-boundary cost.
 */
function derivePlainText(document: DraftRichDocNode): string {
  const chunks: string[] = [];
  let utf16Units = 0;

  const push = (chunk: string): void => {
    utf16Units += chunk.length;
    if (utf16Units > DRAFT_DESCRIPTION_PLAIN_MAX_BYTES) throw new DraftDescriptionPlainBudgetError();
    chunks.push(chunk);
  };

  const stack: TraversalFrame[] = [{ children: document.content, newlineJoin: true, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.children.length) {
      stack.pop();
      continue;
    }
    const position = frame.index;
    frame.index += 1;
    if (frame.newlineJoin && position > 0) push("\n");

    const node = frame.children[position];
    switch (node.type) {
      case "text":
        push(node.text);
        break;
      case "hardBreak":
        push("\n");
        break;
      case "paragraph":
        stack.push({ children: node.content ?? [], newlineJoin: false, index: 0 });
        break;
      case "listItem":
      case "bulletList":
      case "orderedList":
        stack.push({ children: node.content, newlineJoin: true, index: 0 });
        break;
      default:
        break;
    }
  }

  const joined = chunks.join("");
  if (encodeBytes(joined) > DRAFT_DESCRIPTION_PLAIN_MAX_BYTES) {
    throw new DraftDescriptionPlainBudgetError();
  }
  return joined;
}

/**
 * Validate `input` as the complete nullable description, then derive its plain
 * text. Returns `null` iff the description is `null`; throws `ZodError` for an
 * invalid structure/marks and `DraftDescriptionPlainBudgetError` when the
 * result exceeds the plain byte budget. Never returns partial output.
 */
export function deriveDraftDescriptionPlain(input: unknown): string | null {
  const description = draftRichDescriptionStructureSchema.parse(input);
  if (description === null) return null;
  return derivePlainText(description.document);
}
