"use client";

import * as React from "react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  Undo2Icon,
  UnlinkIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildProofExtensions,
  isSafeExternalHref,
} from "@/features/jobs/tiptap-contract-proof/schema";
import { FONT_SIZE_PRESETS } from "@/features/jobs/tiptap-contract-proof/schema";
import type { FontSizePreset } from "@/features/jobs/tiptap-contract-proof/schema";
import type { DraftRichDescription } from "../rich/grammar";

/**
 * Controlled rich description editor over the accepted restricted document
 * grammar.
 *
 * The mounted ProseMirror surface uses the approved Tiptap extension set
 * (`buildProofExtensions`, read-only reuse) and never writes to its value on
 * mount: the accepted JSON stays untouched until the user edits, and only an
 * explicit clear becomes `null`. The parent keeps the raw value; this component
 * reports a validated-shape envelope through `onChange`.
 */

/** Exclusive inclusive `href` bound of the contract (§5.2). */
const LINK_MAX_CODE_POINTS = 2048;
const UNSAFE_LINK_MESSAGE = "Ingresa un enlace que empiece con http:// o https://.";

/** A document with no visible content: the user cleared the whole description. */
export function isBlankDocument(document: JSONContent): boolean {
  const content = document.content ?? [];
  if (content.length === 0) return true;
  if (content.length > 1) return false;
  const [only] = content;
  return (
    only?.type === "paragraph" &&
    (only.content === undefined || only.content.length === 0)
  );
}

/** Maps one editor document to the accepted wire value. */
export function documentToDraftDescription(document: JSONContent): DraftRichDescription {
  if (isBlankDocument(document)) return null;
  return { schema_version: 1, document: document as never };
}

/** Absolute http(s) destination inside the contract bound. */
function isAcceptedHref(raw: string): boolean {
  return [...raw].length <= LINK_MAX_CODE_POINTS && isSafeExternalHref(raw);
}

/**
 * Applies one link destination through the real editor. Unsafe destinations
 * change nothing. An empty selection inserts the address itself as link text,
 * because a stored mark alone would be invisible and unverifiable.
 */
export function applyLinkToEditor(editor: Editor, rawUrl: string): boolean {
  if (!isAcceptedHref(rawUrl)) return false;
  if (editor.state.selection.empty) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: rawUrl,
        marks: [{ type: "link", attrs: { href: rawUrl } }],
      })
      .run();
    return true;
  }
  return editor.chain().focus().setLink({ href: rawUrl }).run();
}

export type DraftDescriptionEditorProps = {
  value: DraftRichDescription;
  onChange: (value: DraftRichDescription) => void;
  /** Present only while invalid, so `aria-invalid` stays truthful. */
  error?: string;
};

const SIZE_LABELS: Record<FontSizePreset, string> = {
  small: "Tamaño pequeño",
  normal: "Tamaño normal",
  large: "Tamaño grande",
};

/**
 * Presentation for the accepted marks and lists inside the editing surface.
 *
 * The step-four preview already maps the presets to `text-sm`/`text-base`/
 * `text-lg`, and Tailwind's reset removes the native list markers, so the rich
 * surface has to declare the same scoped rules itself: the emitted
 * `span[data-font-size-preset]` and the `ul`/`ol` trees carry no presentation
 * on their own. These are literal arbitrary variants scoped to the editor
 * element only, so no global stylesheet, shared schema or stored document
 * changes.
 */
const EDITOR_SURFACE_CLASS = [
  "min-h-40 px-3 py-2 text-sm outline-none",
  "[&_span[data-font-size-preset=small]]:text-sm",
  "[&_span[data-font-size-preset=normal]]:text-base",
  "[&_span[data-font-size-preset=large]]:text-lg",
  "[&_ul]:list-disc [&_ol]:list-decimal",
  "[&_ul]:pl-6 [&_ol]:pl-6",
  "[&_ul]:my-2 [&_ol]:my-2",
].join(" ");

export function DraftDescriptionEditor({
  value,
  onChange,
  error,
}: DraftDescriptionEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<Editor | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  /** The last value this component produced or accepted; it is never echoed. */
  const lastValueRef = React.useRef<DraftRichDescription>(value);
  const initialValueRef = React.useRef<DraftRichDescription>(value);
  const [, forceRender] = React.useState(0);

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);

  const invalid = error !== undefined;
  const linkInputId = "draft-description-link";
  const linkErrorId = "draft-description-link-error";
  const editorErrorId = "draft-description-error";

  React.useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const initial = initialValueRef.current;
    const editor = new Editor({
      element: host,
      extensions: buildProofExtensions(),
      content: initial === null ? undefined : initial.document,
      editorProps: {
        attributes: {
          "aria-label": "Descripción de la vacante",
          "aria-multiline": "true",
          class: EDITOR_SURFACE_CLASS,
        },
      },
      onUpdate: ({ editor: instance }) => {
        const next = documentToDraftDescription(instance.getJSON());
        lastValueRef.current = next;
        onChangeRef.current(next);
      },
    });
    editorRef.current = editor;
    const refresh = () => forceRender((revision) => revision + 1);
    editor.on("transaction", refresh);
    refresh();
    return () => {
      editor.off("transaction", refresh);
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // External value changes re-sync the surface; our own emissions never echo.
  React.useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const editor = editorRef.current;
    if (editor === null) return;
    editor.commands.setContent(
      value === null ? { type: "doc", content: [{ type: "paragraph" }] } : value.document,
      { emitUpdate: false },
    );
  }, [value]);

  const editor = editorRef.current;

  function run(command: (instance: Editor) => void) {
    const instance = editorRef.current;
    if (instance === null) return;
    command(instance);
  }

  function handleApplyLink() {
    const instance = editorRef.current;
    if (instance === null) return;
    if (!applyLinkToEditor(instance, linkUrl)) {
      setLinkError(UNSAFE_LINK_MESSAGE);
      return;
    }
    setLinkError(null);
    setLinkUrl("");
    setLinkOpen(false);
  }

  const active = (name: string, attrs?: Record<string, unknown>) =>
    editor?.isActive(name, attrs) ?? false;
  /** The one active size preset, or `null`; the group is driven by the editor. */
  const activeSizePreset =
    FONT_SIZE_PRESETS.find((preset) => active("fontSizePreset", { preset })) ?? null;

  return (
    <Field data-invalid={invalid} id="draft-description">
      <div className="flex flex-col gap-3">
        <div
          role="toolbar"
          aria-label="Formato de la descripción"
          className="flex flex-wrap items-center gap-1"
        >
          <Toggle
            pressed={active("bold")}
            onPressedChange={() =>
              run((instance) => instance.chain().focus().toggleBold().run())
            }
            className="h-10"
            aria-keyshortcuts="Control+B"
          >
            <BoldIcon data-icon="inline-start" />
            Negrita
          </Toggle>
          <Toggle
            pressed={active("italic")}
            onPressedChange={() =>
              run((instance) => instance.chain().focus().toggleItalic().run())
            }
            className="h-10"
            aria-keyshortcuts="Control+I"
          >
            <ItalicIcon data-icon="inline-start" />
            Cursiva
          </Toggle>
          <ToggleGroup
            aria-label="Tamaño de letra"
            value={activeSizePreset === null ? [] : [activeSizePreset]}
            onValueChange={(next) => {
              const preset = FONT_SIZE_PRESETS.find(
                (candidate) => candidate === next[0],
              );
              if (preset === undefined) return;
              run((instance) =>
                instance.chain().focus().setFontSizePreset(preset).run(),
              );
            }}
          >
            {FONT_SIZE_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset} value={preset} className="h-10">
                {SIZE_LABELS[preset]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Toggle
            pressed={active("bulletList")}
            onPressedChange={() =>
              run((instance) => instance.chain().focus().toggleBulletList().run())
            }
            className="h-10"
          >
            <ListIcon data-icon="inline-start" />
            Lista con viñetas
          </Toggle>
          <Toggle
            pressed={active("orderedList")}
            onPressedChange={() =>
              run((instance) => instance.chain().focus().toggleOrderedList().run())
            }
            className="h-10"
          >
            <ListOrderedIcon data-icon="inline-start" />
            Lista numerada
          </Toggle>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            onClick={() => {
              setLinkError(null);
              setLinkOpen((open) => !open);
            }}
          >
            <LinkIcon data-icon="inline-start" />
            Agregar enlace
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            disabled={!active("link")}
            onClick={() => run((instance) => instance.chain().focus().unsetLink().run())}
          >
            <UnlinkIcon data-icon="inline-start" />
            Quitar enlace
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            aria-label="Deshacer"
            disabled={!(editor?.can().undo() ?? false)}
            onClick={() => run((instance) => instance.chain().focus().undo().run())}
          >
            <Undo2Icon data-icon="inline-start" />
            Deshacer
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            aria-label="Rehacer"
            disabled={!(editor?.can().redo() ?? false)}
            onClick={() => run((instance) => instance.chain().focus().redo().run())}
          >
            <Redo2Icon data-icon="inline-start" />
            Rehacer
          </Button>
        </div>

        {linkOpen ? (
          <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-muted/40 p-3">
            <Field data-invalid={linkError !== null} className="min-w-64 flex-1">
              <FieldLabel htmlFor={linkInputId}>Dirección del enlace</FieldLabel>
              <Input
                id={linkInputId}
                value={linkUrl}
                inputMode="url"
                autoComplete="off"
                placeholder="https://ejemplo.com"
                aria-invalid={linkError !== null}
                aria-describedby={linkError === null ? undefined : linkErrorId}
                onChange={(event) => {
                  setLinkUrl(event.target.value);
                  if (linkError !== null) setLinkError(null);
                }}
              />
              <FieldError id={linkErrorId}>{linkError}</FieldError>
            </Field>
            <Button type="button" variant="outline" className="h-10" onClick={handleApplyLink}>
              Aplicar enlace
            </Button>
          </div>
        ) : null}

        <div
          ref={hostRef}
          className="rounded-2xl border border-transparent bg-input/30 transition-[color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 aria-invalid:border-destructive"
          aria-invalid={invalid}
        />
        <FieldError id={editorErrorId}>{error}</FieldError>
      </div>
    </Field>
  );
}
