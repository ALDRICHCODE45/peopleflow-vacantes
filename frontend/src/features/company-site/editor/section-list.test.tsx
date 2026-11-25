import "./browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { defaultBlock, defaultSiteDraft } from "../defaults";
import { createEditorState, type EditorState } from "../editor-state";
import type { AutosaveController } from "../autosave";
import type { BlockType } from "../model";
import { SectionList } from "./section-list";
import { SECTION_ICONS } from "./section-icons";
import { SectionDragPreviewProvider, useSectionDragPreview } from "./dnd/section-drag-preview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const TYPES: BlockType[] = ["hero", "story", "jobs", "faq", "closing"];
function editorWith(types: BlockType[] = TYPES, change: (state: EditorState) => void = () => {}) {
  const draft = { ...defaultSiteDraft(), blocks: types.map(type => defaultBlock(type)) };
  const state = createEditorState({ draft, draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-11-25T00:00:00Z" }, '"1"');
  change(state);
  return state;
}
function setup(editor = editorWith()) {
  const dispatch = vi.fn(); const onReorder = vi.fn();
  const view = render(<SectionList editor={editor} controller={{ dispatch } as unknown as AutosaveController} onSelect={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} onReorder={onReorder} />);
  return { ...view, editor, dispatch, onReorder };
}
const id = (editor: EditorState, type: BlockType) => editor.draft.blocks.find(block => block.type === type)!.id;
const announcer = () => document.querySelector("[data-drag-announcer]");
const grip = (label: string) => screen.getByRole("button", { name: `Arrastrar ${label}` });
const rowOf = (label: string) => screen.getByRole("button", { name: `Seleccionar ${label}` }).closest('[role="listitem"]') as HTMLElement;
function press(target: HTMLElement, key: string) { fireEvent.keyDown(target, { key }); }

describe("section rows (S3)", () => {
  it("opens every row with a tinted 32 px tile holding the section's own icon", () => {
    setup();
    for (const label of ["Portada", "Historia", "Vacantes abiertas", "Preguntas frecuentes", "Cierre"]) {
      const tile = rowOf(label).querySelector("[data-section-type-icon]");
      expect(tile).toHaveClass("size-8", "rounded-lg");
      expect(tile?.querySelector("svg")).not.toBeNull();
    }
    expect(new Set(Object.values(SECTION_ICONS)).size).toBe(Object.keys(SECTION_ICONS).length);
    expect(SECTION_ICONS.hero).not.toBe(SECTION_ICONS.closing);
  });
  it("keeps the title on one line with its layout below and legible status chips outside the title", () => {
    setup(editorWith(TYPES, state => { state.draft.blocks[1] = { ...state.draft.blocks[1], hidden: true }; }));
    const row = rowOf("Historia");
    const title = within(row).getByText("Historia");
    expect(title).toHaveAttribute("title", "Historia");
    expect(title).toHaveClass("truncate", "whitespace-nowrap");
    const indicators = row.querySelector("[data-section-indicators]") as HTMLElement;
    expect(indicators).not.toContainElement(title);
    expect(within(indicators).getByText("Oculta")).toBeVisible();
    expect(within(indicators).queryByText("Incompleta")).toBeNull();
    const faq = rowOf("Preguntas frecuentes").querySelector("[data-section-indicators]") as HTMLElement;
    expect(within(faq).getByText("Incompleta")).toBeVisible();
    expect(rowOf("Portada").querySelector('[data-section-indicators] [aria-label="Sección obligatoria"]')).not.toBeNull();
  });
  it("marks the selected row and keeps a real, named, focusable drag handle", () => {
    setup(editorWith(TYPES, state => { state.selectedId = state.draft.blocks[1].id; }));
    expect(rowOf("Historia")).toHaveAttribute("data-selected", "true");
    expect(rowOf("Portada")).not.toHaveAttribute("data-selected");
    const handle = grip("Historia");
    act(() => handle.focus()); expect(handle).toHaveFocus();
    expect(handle).toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "Acciones de Historia" })).toBeInTheDocument();
  });
});

describe("keyboard drag (S4/S5)", () => {
  it("picks up, moves, drops once with the final index and keeps focus on the handle", () => {
    const { editor, onReorder } = setup();
    const handle = grip("Preguntas frecuentes"); act(() => handle.focus());
    press(handle, " ");
    expect(announcer()).toHaveTextContent("Moviendo Preguntas frecuentes, posición 4 de 5.");
    expect(rowOf("Preguntas frecuentes")).toHaveAttribute("data-drag", "lifted");
    expect(handle).toHaveAttribute("aria-pressed", "true");
    press(handle, "ArrowUp");
    expect(announcer()).toHaveTextContent("Preguntas frecuentes, posición 3 de 5.");
    expect(onReorder).not.toHaveBeenCalled();
    press(handle, "Enter");
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(id(editor, "faq"), 2);
    expect(announcer()).toHaveTextContent("Preguntas frecuentes, posición 3 de 5.");
    expect(rowOf("Preguntas frecuentes")).not.toHaveAttribute("data-drag");
    expect(handle).toHaveFocus();
  });
  it("moves several places in one step and clamps at the end of the list", () => {
    const { editor, onReorder } = setup();
    const handle = grip("Historia"); act(() => handle.focus());
    press(handle, "Enter"); for (let i = 0; i < 6; i++) press(handle, "ArrowDown");
    expect(announcer()).toHaveTextContent("Historia, posición 5 de 5.");
    press(handle, " ");
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(id(editor, "story"), 4);
  });
  it("treats a drop in the same place as a no-op", () => {
    const { onReorder } = setup();
    const handle = grip("Historia"); act(() => handle.focus());
    press(handle, " "); press(handle, "ArrowDown"); press(handle, "ArrowUp"); press(handle, " ");
    expect(onReorder).not.toHaveBeenCalled();
    expect(announcer()).toHaveTextContent("Historia se queda en la posición 2 de 5.");
  });
  it("cancels with Escape, restores the order and keeps focus", () => {
    const { onReorder } = setup();
    const handle = grip("Cierre"); act(() => handle.focus());
    press(handle, " "); press(handle, "ArrowUp"); press(handle, "ArrowUp");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const outer = vi.fn(); document.addEventListener("keydown", outer);
    act(() => { handle.dispatchEvent(escape); });
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
    expect(announcer()).toHaveTextContent("Movimiento cancelado. Cierre se queda en la posición 5 de 5.");
    expect(document.querySelector("[data-drag]")).toBeNull();
    expect(handle).toHaveFocus();
  });
  it("cancels when focus leaves the handle mid-drag", async () => {
    const { onReorder } = setup();
    const handle = grip("Cierre"); act(() => handle.focus());
    press(handle, " "); press(handle, "ArrowUp");
    await userEvent.setup().tab();
    expect(onReorder).not.toHaveBeenCalled();
    expect(announcer()).toHaveTextContent("Movimiento cancelado.");
    expect(document.querySelector("[data-drag]")).toBeNull();
  });
  it("shows a position above Portada as forbidden and cancels a drop there", () => {
    const { onReorder } = setup();
    const handle = grip("Vacantes abiertas"); act(() => handle.focus());
    press(handle, " "); press(handle, "Home");
    expect(announcer()).toHaveTextContent("Posición 1 no permitida: Portada siempre va primero.");
    expect(rowOf("Vacantes abiertas")).toHaveAttribute("data-drag-blocked", "true");
    expect(within(rowOf("Vacantes abiertas")).getByText("Portada siempre va primero.")).toBeInTheDocument();
    press(handle, "Enter");
    expect(onReorder).not.toHaveBeenCalled();
    expect(announcer()).toHaveTextContent("No se puede mover ahí: Portada siempre va primero. Vacantes abiertas se queda en la posición 3 de 5.");
  });
  it("never lets Portada leave the first place", () => {
    const { onReorder } = setup();
    const handle = grip("Portada"); act(() => handle.focus());
    press(handle, " "); press(handle, "ArrowDown");
    expect(rowOf("Portada")).toHaveAttribute("data-drag-blocked", "true");
    press(handle, " ");
    expect(onReorder).not.toHaveBeenCalled();
  });
  it("keeps focus on the moved row's handle after the parent reorders", () => {
    function Harness() {
      const [editor, setEditor] = useState(() => editorWith());
      return <SectionList editor={editor} controller={{ dispatch: vi.fn() } as unknown as AutosaveController} onSelect={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
        onReorder={(moved, to) => setEditor(state => { const blocks = state.draft.blocks.filter(block => block.id !== moved); blocks.splice(to, 0, state.draft.blocks.find(block => block.id === moved)!); return { ...state, draft: { ...state.draft, blocks } }; })} />;
    }
    render(<Harness />);
    act(() => grip("Cierre").focus());
    press(grip("Cierre"), " "); press(grip("Cierre"), "ArrowUp"); press(grip("Cierre"), "ArrowUp"); press(grip("Cierre"), "Enter");
    const order = within(screen.getByRole("list", { name: "Secciones del sitio" })).getAllByRole("button", { name: /^Seleccionar / }).map(button => button.getAttribute("aria-label"));
    expect(order).toEqual(["Seleccionar Portada", "Seleccionar Historia", "Seleccionar Cierre", "Seleccionar Vacantes abiertas", "Seleccionar Preguntas frecuentes"]);
    expect(grip("Cierre")).toHaveFocus();
    expect(announcer()).toHaveTextContent("Cierre, posición 3 de 5.");
  });
  it("cancels a live drag when the list changes under it (undo, reload)", () => {
    const { editor, onReorder, rerender } = setup();
    const handle = grip("Cierre"); act(() => handle.focus());
    press(handle, " "); press(handle, "ArrowUp");
    const reordered = { ...editor, draft: { ...editor.draft, blocks: [editor.draft.blocks[0], editor.draft.blocks[2], editor.draft.blocks[1], editor.draft.blocks[3], editor.draft.blocks[4]] } };
    rerender(<SectionList editor={reordered} controller={{ dispatch: vi.fn() } as unknown as AutosaveController} onSelect={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} onReorder={onReorder} />);
    expect(document.querySelector("[data-drag]")).toBeNull();
    expect(announcer()).toHaveTextContent("Movimiento cancelado.");
    press(grip("Cierre"), "Enter");
    expect(onReorder).not.toHaveBeenCalled();
    press(grip("Cierre"), "Escape");
  });
  it("keeps Alt+arrows on a selected row dispatching the existing move action", () => {
    const { editor, dispatch } = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Seleccionar Historia" }), { key: "ArrowDown", altKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "move", id: id(editor, "story"), direction: 1 });
  });
});

describe("drag preview store", () => {
  function Probe() { const preview = useSectionDragPreview(); return <output data-testid="probe">{preview ? `${preview.activeId}:${preview.toIndex}:${preview.allowed}` : "none"}</output>; }
  it("publishes the active id and prospective index while dragging, and clears it after", () => {
    const editor = editorWith();
    render(<SectionDragPreviewProvider><Probe /><SectionList editor={editor} controller={{ dispatch: vi.fn() } as unknown as AutosaveController} onSelect={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()} onReorder={vi.fn()} /></SectionDragPreviewProvider>);
    const handle = grip("Cierre"); act(() => handle.focus());
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
    press(handle, " "); press(handle, "ArrowUp");
    expect(screen.getByTestId("probe")).toHaveTextContent(`${id(editor, "closing")}:3:true`);
    press(handle, "Home");
    expect(screen.getByTestId("probe")).toHaveTextContent(`${id(editor, "closing")}:0:false`);
    press(handle, "Escape");
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });
  it("reads as idle outside a provider", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });
});
