"use client";

import * as React from "react";
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  applyBold, applyBulletList, applyItalic, applyLink, applyNumberedList,
  parseRichText, sanitizeLinkUrl,
} from "./rich-text-model";
import type { RichTextEdit, RichTextInline, RichTextRange } from "./rich-text-model";

const UNSAFE_LINK_MESSAGE = "Ingresá un enlace que empiece con http:// o https://.";
/** The five toolbar actions, in the order the surface shows them. */
const FORMAT_ACTIONS = [
  { label: "Negrita", icon: BoldIcon, apply: applyBold },
  { label: "Cursiva", icon: ItalicIcon, apply: applyItalic },
  { label: "Lista con viñetas", icon: ListIcon, apply: applyBulletList },
  { label: "Lista numerada", icon: ListOrderedIcon, apply: applyNumberedList },
] as const;

export type RichTextFieldProps = {
  /** Control id, so an enclosing form keeps its label and error wiring. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Present only while invalid, so `aria-invalid` stays truthful. */
  error?: string;
  /** Defaults to `<id>-error`, the shared error-slot convention. */
  errorId?: string;
  placeholder?: string;
  rows?: number;
  /**
   * Compatibility flag for callers whose value is local-only. It is retained so
   * the shared contract stays intact, but it renders nothing and never changes
   * the field's accessible text.
   */
  prototype?: boolean;
};

/**
 * Controlled plain-text field with a formatting toolbar and a live preview: the
 * value stays one plain string, the toolbar only inserts lightweight tokens, and
 * the preview renders those tokens as ordinary elements.
 */
export function RichTextField({
  id,
  label,
  value,
  onChange,
  error,
  errorId = `${id}-error`,
  placeholder,
  rows = 4,
}: RichTextFieldProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = React.useRef<RichTextRange | null>(null);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);

  // The toolbar edits a controlled value, so the selection it asked for is
  // restored once the parent has committed the new value.
  React.useEffect(() => {
    const selection = pendingSelection.current;
    pendingSelection.current = null;
    const textarea = textareaRef.current;
    if (selection === null || textarea === null) return;
    textarea.focus();
    textarea.setSelectionRange(selection.start, selection.end);
  }, [value]);

  const invalid = error !== undefined;
  const linkInputId = `${id}-link`;
  const linkErrorId = `${id}-link-error`;
  /**
   * Every id this component owns. A caller error id may never shadow one of
   * them: a collision resolves to the field's deterministic `${id}-error`,
   * while `${id}-error` itself and every other caller-provided id stay
   * verbatim.
   */
  const reservedIds = [id, linkInputId, linkErrorId];
  const resolvedErrorId = reservedIds.includes(errorId)
    ? `${id}-error`
    : errorId;
  /** Only a present error slot describes the control; a valid field has none. */
  const describedBy = invalid ? resolvedErrorId : undefined;

  function currentSelection(): RichTextRange {
    const textarea = textareaRef.current;
    if (textarea === null) return { start: value.length, end: value.length };
    return { start: textarea.selectionStart, end: textarea.selectionEnd };
  }

  function runEdit(edit: RichTextEdit) {
    pendingSelection.current = edit.selection;
    onChange(edit.value);
  }

  function addLink() {
    if (sanitizeLinkUrl(linkUrl) === null) {
      setLinkError(UNSAFE_LINK_MESSAGE);
      return;
    }
    setLinkError(null);
    runEdit(applyLink(value, currentSelection(), linkUrl));
    setLinkUrl("");
  }

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>

      <div
        role="toolbar"
        aria-label={`Formato de ${label}`}
        className="flex flex-wrap items-center gap-1"
      >
        {FORMAT_ACTIONS.map(({ label: action, icon: Icon, apply }) => (
          <Button
            key={action}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => runEdit(apply(value, currentSelection()))}
          >
            <Icon data-icon="inline-start" />
            {action}
          </Button>
        ))}
      </div>

      <Textarea
        ref={textareaRef}
        id={id}
        name={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        placeholder={placeholder}
      />
      <FieldError id={resolvedErrorId}>{error}</FieldError>

      <div className="flex flex-wrap items-end gap-2">
        <Field className="max-w-xs">
          <FieldLabel htmlFor={linkInputId}>Dirección del enlace</FieldLabel>
          <Input
            id={linkInputId}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            aria-invalid={linkError !== null}
            aria-describedby={linkError !== null ? linkErrorId : undefined}
            placeholder="https://ejemplo.com"
            inputMode="url"
            autoComplete="off"
          />
        </Field>
        <Button type="button" variant="outline" size="sm" onClick={addLink}>
          <LinkIcon data-icon="inline-start" />
          Agregar enlace
        </Button>
      </div>
      <FieldError id={linkErrorId}>{linkError}</FieldError>

      <div
        role="region"
        aria-label={`Vista previa de ${label}`}
        aria-live="polite"
        className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-3"
      >
        <p className="text-xs font-medium text-muted-foreground">Vista previa</p>
        <FormattedPreview value={value} />
      </div>
    </Field>
  );
}

/** Renders one inline fragment. An unsanitized address stays inert text. */
function renderInline(spans: RichTextInline[]): React.ReactNode {
  return spans.map((span, index) => {
    if (span.kind === "bold") return <strong key={index}>{span.text}</strong>;
    if (span.kind === "italic") return <em key={index}>{span.text}</em>;
    if (span.kind === "text") return <React.Fragment key={index}>{span.text}</React.Fragment>;
    return span.href === null ? (
      <span key={index} className="underline decoration-dotted">{span.text}</span>
    ) : (
      <a key={index} href={span.href} className="underline underline-offset-4">{span.text}</a>
    );
  });
}

/** Renders the parsed model as ordinary elements, one element per block. */
function FormattedPreview({ value }: { value: string }) {
  if (value.trim() === "") {
    return <p className="text-sm text-muted-foreground">Sin contenido todavía.</p>;
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {parseRichText(value).map((block, index) => {
        if (block.kind === "paragraph") {
          return <p key={index}>{renderInline(block.spans)}</p>;
        }

        // Both list kinds render the same items; only their marker differs.
        const List = block.kind === "bullet-list" ? "ul" : "ol";
        const marker = block.kind === "bullet-list" ? "list-disc" : "list-decimal";
        return (
          <List key={index} className={cn("flex flex-col gap-1 pl-5", marker)}>
            {block.items.map((item, position) => (
              <li key={position}>{renderInline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
