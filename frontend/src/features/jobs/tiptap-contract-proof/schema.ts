import { Editor, Mark, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import type { LinkOptions } from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions/undo-redo";

/** Product document schema version stored with each draft; this gates writes. */
export const SCHEMA_VERSION = "tiptap-draft-contract/v1";

/**
 * Proof provenance only: exact direct packages pinned for this proof. Not
 * DTO/API fields; the Go validator gates on SCHEMA_VERSION, not npm versions.
 */
export const TIPTAP_PACKAGE_VERSIONS: Record<string, string> = {
  "@tiptap/core": "3.31.4",
  "@tiptap/pm": "3.31.4",
  "@tiptap/extensions": "3.31.4",
  "@tiptap/extension-document": "3.31.4",
  "@tiptap/extension-paragraph": "3.31.4",
  "@tiptap/extension-text": "3.31.4",
  "@tiptap/extension-bold": "3.31.4",
  "@tiptap/extension-italic": "3.31.4",
  "@tiptap/extension-link": "3.31.4",
  "@tiptap/extension-hard-break": "3.31.4",
  "@tiptap/extension-list": "3.31.4",
};

/**
 * Presets pequeño/normal/grande. Experimental output: `normal` is an explicit
 * mark, not a frozen contract. Go must still reject any other `preset` value.
 */
export const FONT_SIZE_PRESETS = ["small", "normal", "large"] as const;
export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSizePreset: {
      setFontSizePreset: (preset: FontSizePreset) => ReturnType;
      unsetFontSizePreset: () => ReturnType;
    };
  }
}

function readPreset(element: HTMLElement): FontSizePreset | null {
  const value = element.getAttribute("data-font-size-preset");
  return value !== null && (FONT_SIZE_PRESETS as readonly string[]).includes(value)
    ? (value as FontSizePreset)
    : null;
}

export const FontSizePresetMark = Mark.create({
  name: "fontSizePreset",
  addAttributes() {
    return {
      preset: {
        default: "normal" satisfies FontSizePreset,
        parseHTML: (element) => readPreset(element),
        renderHTML: (attributes) => ({
          "data-font-size-preset": attributes.preset,
        }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-font-size-preset]",
        // Reject out-of-enum HTML instead of coercing it into a valid preset.
        getAttrs: (element) => (readPreset(element) === null ? false : null),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setFontSizePreset:
        (preset: FontSizePreset) =>
        ({ commands }) => {
          if (!FONT_SIZE_PRESETS.includes(preset)) return false;
          return commands.setMark(this.name, { preset });
        },
      unsetFontSizePreset:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** Raw whitespace, control characters and backslashes are never accepted. */
const RAW_UNSAFE = /[\s\\\u0000-\u001f\u007f]/u;
/** Requires explicit `http://` or `https://`, not WHATWG-normalized shortcuts. */
const EXPLICIT_SCHEME = /^https?:\/\//i;

/**
 * External absolute explicit HTTP(S) only. Independent from the legacy
 * token-parser punctuation rules; ordinary punctuation and Unicode paths stay
 * valid. Rejects raw whitespace/control/backslash, userinfo credentials and
 * nonexplicit forms WHATWG would normalize. Guards commands/HTML parsing only;
 * JSON is untrusted, so Go must re-validate stored documents.
 */
export function isSafeExternalHref(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  if (RAW_UNSAFE.test(raw)) return false;
  if (!EXPLICIT_SCHEME.test(raw)) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return parsed.hostname !== "";
}

const SafeLink = Link.extend({
  addOptions() {
    return {
      ...(this.parent?.() as LinkOptions),
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      isAllowedUri: (url: string) => isSafeExternalHref(url),
    };
  },
});

export function buildProofExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    SafeLink,
    HardBreak,
    BulletList,
    OrderedList,
    ListItem,
    UndoRedo,
    FontSizePresetMark,
  ];
}

/** Headless restricted editor used by the proof tests and fixture emitter. */
export function createProofEditor(content?: JSONContent): Editor {
  return new Editor({ extensions: buildProofExtensions(), content });
}

/**
 * Proposed server-side plain text: concatenate inline text, hardBreak "\n",
 * block/list/listItem children join with "\n", no trimming and no markers.
 */
export function toPlainText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "doc":
    case "bulletList":
    case "orderedList":
    case "listItem":
      return (node.content ?? []).map(toPlainText).join("\n");
    default:
      return (node.content ?? []).map(toPlainText).join("");
  }
}
