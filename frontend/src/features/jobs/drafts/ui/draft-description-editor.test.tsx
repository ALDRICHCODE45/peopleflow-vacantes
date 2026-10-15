import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

import { buildProofExtensions } from "@/features/jobs/tiptap-contract-proof/schema";
import type { DraftRichDescription } from "../rich/grammar";
import {
  DraftDescriptionEditor,
  applyLinkToEditor,
  documentToDraftDescription,
} from "./draft-description-editor";

const richValue: DraftRichDescription = {
  schema_version: 1,
  document: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
  },
};

const blankValue: DraftRichDescription = {
  schema_version: 1,
  document: { type: "doc", content: [{ type: "paragraph" }] },
};

/** Nested bullet list inside an ordered list that starts at 3. */
const nestedListValue: DraftRichDescription = {
  schema_version: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3, type: null },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Tercero" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "Anidado" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

const live: Editor[] = [];
function openEditor(content?: JSONContent) {
  const editor = new Editor({ extensions: buildProofExtensions(), content });
  live.push(editor);
  return editor;
}

/**
 * jsdom implements no layout, so its `Range` has neither `getClientRects` nor
 * `getBoundingClientRect`. ProseMirror calls both from `coordsAtPos` while
 * scrolling the selection into view, which the real undo command triggers.
 * These shims return empty geometry (all zeros), exactly what jsdom reports
 * for laid-out DOM; they do not replace the editor, its history or its state.
 */
beforeAll(() => {
  const zeroRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  Range.prototype.getClientRects = function getClientRects() {
    return [] as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = zeroRect;
});

afterEach(() => {
  cleanup();
  while (live.length > 0) live.pop()?.destroy();
});

describe("documentToDraftDescription", () => {
  it("keeps a non-blank document as a versioned envelope", () => {
    const value = documentToDraftDescription({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
    });

    expect(value).toEqual({
      schema_version: 1,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
      },
    });
  });

  it("maps a fully cleared editor to null, not to an invalid empty document", () => {
    expect(documentToDraftDescription({ type: "doc", content: [] })).toBeNull();
    expect(
      documentToDraftDescription({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBeNull();
    expect(
      documentToDraftDescription({ type: "doc", content: [{ type: "paragraph", content: [] }] }),
    ).toBeNull();
  });

  it("respects blank paragraphs among real content", () => {
    const value = documentToDraftDescription({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "Fin" }] },
      ],
    });

    expect(value).not.toBeNull();
    expect(value?.document.content).toHaveLength(2);
  });
});

describe("applyLinkToEditor", () => {
  it("rejects an unsafe destination without touching the document", () => {
    const editor = openEditor({ type: "doc", content: [{ type: "paragraph" }] });

    expect(applyLinkToEditor(editor, "javascript:alert(1)")).toBe(false);
    expect(editor.getJSON()).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("accepts an absolute http(s) destination and stores every link attr", () => {
    const editor = openEditor({ type: "doc", content: [{ type: "paragraph" }] });

    expect(applyLinkToEditor(editor, "https://example.com/vacante")).toBe(true);
    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      type: "link",
      attrs: {
        href: "https://example.com/vacante",
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: null,
        title: null,
      },
    });
  });
});

describe("DraftDescriptionEditor", () => {
  it("mounts the accepted rich JSON without silently emitting a change", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descripción de la vacante")).toHaveTextContent("Hola");
  });

  it("mounts a blank accepted document without rewriting it to null outside an edit", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={blankValue} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders real toolbar labels and keyboard shortcuts", () => {
    render(<DraftDescriptionEditor value={richValue} onChange={vi.fn()} />);

    const toolbar = screen.getByRole("toolbar", { name: "Formato de la descripción" });
    expect(toolbar).toBeInTheDocument();
    for (const label of [
      "Negrita",
      "Cursiva",
      "Tamaño pequeño",
      "Tamaño normal",
      "Tamaño grande",
      "Lista con viñetas",
      "Lista numerada",
      "Agregar enlace",
      "Quitar enlace",
      "Deshacer",
      "Rehacer",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Negrita" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+B",
    );
  });

  it("reports an edit through onChange with a versioned envelope", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);

    const editable = screen.getByLabelText("Descripción de la vacante");
    fireEvent.paste(editable, {
      clipboardData: { getData: () => " y adiós", types: ["text/plain"] },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DraftRichDescription;
    expect(next?.schema_version).toBe(1);
    expect(JSON.stringify(next)).toContain("y adiós");
  });

  it("rejects an unsafe link with a visible error and no change", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Dirección del enlace" }), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar enlace" }));

    expect(
      screen.getByText("Ingresa un enlace que empiece con http:// o https://."),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies a valid link through the real editor", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Dirección del enlace" }), {
      target: { value: "https://example.com/vacante" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar enlace" }));

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as DraftRichDescription;
    expect(JSON.stringify(next)).toContain("https://example.com/vacante");
  });

  it("re-syncs from an external value change without echoing it back", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DraftDescriptionEditor value={richValue} onChange={onChange} />,
    );

    rerender(
      <DraftDescriptionEditor
        value={{
          schema_version: 1,
          document: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Externo" }] }],
          },
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Descripción de la vacante")).toHaveTextContent("Externo");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the passed error against the editing surface", () => {
    render(
      <DraftDescriptionEditor
        value={richValue}
        onChange={vi.fn()}
        error="La descripción no cumple el formato permitido."
      />,
    );

    expect(
      screen.getByText("La descripción no cumple el formato permitido."),
    ).toBeVisible();
  });
});

/**
 * Scoped presentation hooks the second step needs so the accepted marks and
 * lists are actually visible inside the rich editor. Tailwind's reset removes
 * native list markers and the emitted `span[data-font-size-preset]` carries no
 * presentation on its own, so the surface must declare these literal
 * arbitrary variants. The preview (step 4) already maps the same presets to
 * `text-sm`/`text-base`/`text-lg`.
 */
const REQUIRED_PRESENTATION_HOOKS = [
  "[&_span[data-font-size-preset=small]]:text-sm",
  "[&_span[data-font-size-preset=normal]]:text-base",
  "[&_span[data-font-size-preset=large]]:text-lg",
  "[&_ul]:list-disc",
  "[&_ol]:list-decimal",
  "[&_ul]:pl-6",
  "[&_ol]:pl-6",
] as const;

/** Selects the whole text of the first paragraph the way a user would. */
function selectFirstParagraphText(editable: HTMLElement): void {
  act(() => {
    editable.focus();
  });
  const textNode = editable.querySelector("p")?.firstChild ?? editable;
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const domSelection = window.getSelection();
  if (domSelection === null) throw new Error("jsdom exposes no DOM selection");
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("DraftDescriptionEditor step-two presentation", () => {
  it("exposes the scoped hooks that make step-two formatting visible", () => {
    render(<DraftDescriptionEditor value={richValue} onChange={vi.fn()} />);
    const editable = screen.getByLabelText("Descripción de la vacante") as HTMLElement;

    for (const hook of REQUIRED_PRESENTATION_HOOKS) {
      expect(editable.className).toContain(hook);
    }
  });

  it("applies the chosen size to the selected text through the real toolbar", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);
    const editable = screen.getByLabelText("Descripción de la vacante") as HTMLElement;

    selectFirstParagraphText(editable);
    fireEvent.click(screen.getByRole("button", { name: "Tamaño pequeño" }));

    const marked = editable.querySelector('span[data-font-size-preset="small"]');
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent("Hola");
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('"preset":"small"');
  });

  it("toggles the bullet and ordered list structures through the real toolbar", () => {
    const bulletChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={bulletChange} />);
    const bulletSurface = screen.getByLabelText(
      "Descripción de la vacante",
    ) as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Lista con viñetas" }));
    expect(bulletSurface.querySelector("ul")).not.toBeNull();
    expect(JSON.stringify(bulletChange.mock.calls.at(-1)?.[0])).toContain('"bulletList"');

    cleanup();
    const orderedChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={orderedChange} />);
    const orderedSurface = screen.getByLabelText(
      "Descripción de la vacante",
    ) as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Lista numerada" }));
    expect(orderedSurface.querySelector("ol")).not.toBeNull();
    expect(JSON.stringify(orderedChange.mock.calls.at(-1)?.[0])).toContain('"orderedList"');
  });

  it("renders nested lists with their exact ordered start", () => {
    render(<DraftDescriptionEditor value={nestedListValue} onChange={vi.fn()} />);
    const editable = screen.getByLabelText("Descripción de la vacante") as HTMLElement;

    const ordered = editable.querySelector('ol[start="3"]');
    expect(ordered).not.toBeNull();
    expect(ordered?.querySelector("ul")).not.toBeNull();
    expect(ordered).toHaveTextContent("Tercero");
    expect(ordered).toHaveTextContent("Anidado");
  });
});

/**
 * The toolbar formatting controls are the native `Toggle` primitive, whose
 * pressed state is controlled by the live editor instead of a local boolean.
 * The visible feedback is the primitive's own pressed attribute, so it follows
 * the real caret/selection and undo/redo instead of a guessed local state.
 */
const twoParagraphValue: DraftRichDescription = {
  schema_version: 1,
  document: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Negrita" }] },
      { type: "paragraph", content: [{ type: "text", text: "Plano" }] },
    ],
  },
};

/** Selects the whole text of the paragraph at `index`, the way a user would. */
function selectParagraphText(editable: HTMLElement, index: number): void {
  act(() => {
    editable.focus();
  });
  const paragraph = editable.querySelectorAll("p")[index];
  if (paragraph === undefined) throw new Error(`no paragraph at index ${index}`);
  const textNode = paragraph.firstChild ?? paragraph;
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const domSelection = window.getSelection();
  if (domSelection === null) throw new Error("jsdom exposes no DOM selection");
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("DraftDescriptionEditor toolbar feedback", () => {
  it("renders the formatting controls as native toggles", () => {
    render(<DraftDescriptionEditor value={richValue} onChange={vi.fn()} />);

    for (const label of ["Negrita", "Cursiva", "Lista con viñetas", "Lista numerada"]) {
      const control = screen.getByRole("button", { name: label });
      expect(control).toHaveAttribute("data-slot", "toggle");
    }

    const sizeGroup = screen.getByRole("group", { name: "Tamaño de letra" });
    expect(sizeGroup).toHaveAttribute("data-slot", "toggle-group");
  });

  it("controls the pressed state from the real selection, undo and redo", () => {
    render(<DraftDescriptionEditor value={twoParagraphValue} onChange={vi.fn()} />);
    const editable = screen.getByLabelText("Descripción de la vacante") as HTMLElement;
    const bold = screen.getByRole("button", { name: "Negrita" });

    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(bold).not.toHaveAttribute("data-pressed");

    selectParagraphText(editable, 0);
    fireEvent.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(bold).toHaveAttribute("data-pressed");

    // Moving the caret to unformatted text clears the pressed state.
    selectParagraphText(editable, 1);
    expect(bold).toHaveAttribute("aria-pressed", "false");

    // Back over the formatted text it reads pressed again.
    selectParagraphText(editable, 0);
    expect(bold).toHaveAttribute("aria-pressed", "true");

    // Undo drops the bold mark and the control reflects the new reality.
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(bold).not.toHaveAttribute("data-pressed");

    // Redo restores it, and the control follows the restored editor state.
    fireEvent.click(screen.getByRole("button", { name: "Rehacer" }));
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(bold).toHaveAttribute("data-pressed");
  });

  it("keeps the font size a single controlled choice of the size group", () => {
    const onChange = vi.fn();
    render(<DraftDescriptionEditor value={richValue} onChange={onChange} />);
    const editable = screen.getByLabelText("Descripción de la vacante") as HTMLElement;
    const small = screen.getByRole("button", { name: "Tamaño pequeño" });
    const large = screen.getByRole("button", { name: "Tamaño grande" });
    expect(small).toHaveAttribute("data-slot", "toggle-group-item");

    selectFirstParagraphText(editable);
    fireEvent.click(small);
    expect(small).toHaveAttribute("aria-pressed", "true");
    expect(large).toHaveAttribute("aria-pressed", "false");

    // Pressing the active size again cannot unset a mark: the choice stays and
    // the editor is not mutated a second time.
    const applied = onChange.mock.calls.length;
    fireEvent.click(small);
    expect(small).toHaveAttribute("aria-pressed", "true");
    expect(onChange).toHaveBeenCalledTimes(applied);

    fireEvent.click(large);
    expect(large).toHaveAttribute("aria-pressed", "true");
    expect(small).toHaveAttribute("aria-pressed", "false");
  });
});
