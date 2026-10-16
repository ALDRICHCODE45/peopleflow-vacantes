import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SubstatesSheet } from "./sheet";
import { populatedSubstates } from "./test-fixture";
import { substateRowActions } from "./row";
import { fromCatalog } from "@/features/jobs/drafts/pipeline/substates-model";
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const field = (n: number) => screen.getByRole("textbox", { name: `Nombre del subestado ${n}` });
function mount() {
  return render(<SubstatesSheet open draftId="123e4567-e89b-42d3-a456-426614174000" inProcessName="Entrevistas" catalog={populatedSubstates()} etag='"substates-1"' onOpenChange={vi.fn()} onSaved={vi.fn()} />);
}
function measureRows() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.matches('li[data-slot="item"]');
    const overlay = this.matches('div[data-slot="item"]') && this.parentElement?.style.position === "fixed";
    // jsdom has no layout: supply geometry for the Sheet's scroll viewport too.
    if (this.classList.contains("overflow-y-auto")) return { x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 600, width: 600, height: 600, toJSON: () => ({}) };
    if (!row && !overlay) return original.call(this);
    const index = row ? Array.from(this.parentElement!.children).indexOf(this) : 0;
    const style = overlay ? this.parentElement!.style : this.style;
    const translation = style.transform.match(/translate3d\([^,]+,\s*([-\d.]+)px/);
    const top = row ? index * 100 : parseFloat(style.top) + Number(translation?.[1] ?? 0);
    return { x: 0, y: top, top, left: 0, bottom: top + 80, right: 600, width: 600, height: 80, toJSON: () => ({}) };
  });
}
it("pins the menu actions and free removal at either endpoint independently of the portal", () => {
  const state = fromCatalog(populatedSubstates());
  expect(substateRowActions(state, "one")).toEqual([
    { id: "up", label: "Subir", disabled: true }, { id: "down", label: "Bajar", disabled: false }, { id: "remove", label: "Quitar subestado", disabled: false },
  ]);
  expect(substateRowActions(state, "three")).toEqual([
    { id: "up", label: "Subir", disabled: false }, { id: "down", label: "Bajar", disabled: true }, { id: "remove", label: "Quitar subestado", disabled: false },
  ]);
});
it("uses compact outlined rows with a handle, shared legible medallion, shrinking input and one menu", () => {
  mount();
  const rows = within(screen.getByRole("list", { name: "Subestados" })).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row).toHaveAttribute("data-variant", "outline"); expect(row).toHaveAttribute("data-size", "xs");
    expect(row).not.toHaveClass("bg-muted"); expect(row).toHaveClass("flex-nowrap");
    const handle = within(row).getByRole("button", { name: /^Arrastrar / });
    const medallion = row.querySelector('[data-slot="item-media"]')!;
    expect(handle).toHaveClass("size-10", "touch-none"); expect(handle.compareDocumentPosition(medallion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(medallion).toHaveClass("bg-primary/12", "text-foreground", "ring-primary/40"); expect(medallion).not.toHaveClass("text-primary");
    expect(row.querySelector('[data-slot="item-content"]')).toHaveClass("min-w-0");
    expect(within(row).getByRole("button", { name: /^Acciones de / })).toHaveAttribute("aria-haspopup", "menu");
  }
});
it("moves to both endpoints by keyboard, and drag Escape cancels only the drag rather than closing the Sheet", async () => {
  measureRows(); const user = userEvent.setup(); mount();
  const handle = screen.getByRole("button", { name: "Arrastrar Primera entrevista" });
  // Let the modal's initial focus commit before choosing the drag handle.
  await user.click(handle); expect(handle).toHaveFocus();
  await user.keyboard("[Space]"); expect(handle).toHaveAttribute("aria-pressed", "true");
  await user.keyboard("[ArrowDown]"); expect(screen.getByText("Primera entrevista sobre la posición 2")).toBeInTheDocument();
  await user.keyboard("[ArrowDown]"); await user.keyboard("[Space]");
  expect(field(3)).toHaveValue("Primera entrevista"); expect(handle).toHaveFocus();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[Escape]"); expect(field(3)).toHaveValue("Primera entrevista");
  expect(screen.queryByRole("dialog", { name: "¿Descartar los cambios de subestados?" })).not.toBeInTheDocument();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[Space]");
  expect(field(1)).toHaveValue("Primera entrevista");
  expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeDisabled();
});
it.each([false, true])("uses real pointer sensors and drops outside=%s without accidental reordering", async outside => {
  measureRows(); const user = userEvent.setup(); mount();
  await user.pointer([{ keys: "[MouseLeft>]", target: field(1), coords: { x: 250, y: 40 } }, { coords: { x: 250, y: 240 } }, { keys: "[/MouseLeft]" }]);
  expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeDisabled();
  const handle = screen.getByRole("button", { name: "Arrastrar Primera entrevista" });
  await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { x: 20, y: 40 } }, { coords: { x: 20, y: 60 } }, { coords: outside ? { x: 900, y: 900 } : { x: 20, y: 240 } }]);
  await user.pointer({ keys: "[/MouseLeft]" }); expect(field(outside ? 1 : 3)).toHaveValue("Primera entrevista");
  if (outside) expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeDisabled();
  else expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeEnabled();
});
