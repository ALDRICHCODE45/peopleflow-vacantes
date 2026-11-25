import "./browser-platform.test-support";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { sileo } from "sileo";
import { CareersSiteEditor } from "./index";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlockV2 as defaultBlock } from "../defaults";
import type { SiteResult, SiteState } from "../api/model";
import { saveDraftAction } from "../api/actions";
import { v2Draft } from "./site-state.test-support";
vi.mock("sileo", () => ({ sileo: { success: vi.fn().mockReturnValue("toast"), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn(), slugAvailabilityAction: vi.fn().mockResolvedValue({ kind: "uncertain" }), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
vi.mock("./media", () => ({ ImageField: ({ label }: { label: string }) => <p>{label}</p> }));
function fixture() {
  const data = publishedFixture();
  const draft = v2Draft({ ...data.site, slug: data.slug });
  if (!draft.blocks.some(block => block.type === "story")) draft.blocks.splice(1, 0, defaultBlock("story"));
  const initialSite: SiteState = { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  return { initialSite, role: "owner", preview: { company: data.company, jobs: [], officeLabels: new Map<string, string>() } };
}
async function mount() {
  const props = fixture(); render(<CareersSiteEditor {...props} />);
  await screen.findByRole("heading", { name: "Tu página" });
  return props;
}
const list = () => screen.getByRole("list", { name: "Secciones del sitio" });
const row = (name: string) => within(list()).getByRole("button", { name: `Seleccionar ${name}` }).closest('[role="listitem"]') as HTMLElement;
const names = () => within(list()).getAllByRole("button", { name: /^Seleccionar / }).map(button => button.getAttribute("aria-label"));
const undoButton = () => screen.getByRole("button", { name: "Deshacer" });
const redoButton = () => screen.getByRole("button", { name: "Rehacer" });
const title = () => screen.getByLabelText("Título principal") as HTMLInputElement;
const key = (target: Element, init: KeyboardEventInit) => fireEvent.keyDown(target, init);
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-panel") ? 400 : 0; });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(saveDraftAction).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...fixture().initialSite, draft: body as SiteState["draft"], draft_version: 8 }, etag: '"8"' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("offers accessible Deshacer/Rehacer buttons that follow the history and autosave the result", async () => {
  await mount();
  expect(undoButton()).toBeDisabled(); expect(redoButton()).toBeDisabled();
  expect(undoButton()).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Control+Z"));
  expect(redoButton()).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Control+Y"));
  const original = title().value;
  vi.useFakeTimers();
  fireEvent.change(title(), { target: { value: "Crece con nosotros" } });
  expect(undoButton()).toBeEnabled();
  fireEvent.click(undoButton());
  expect(title().value).toBe(original); expect(undoButton()).toBeDisabled(); expect(redoButton()).toBeEnabled();
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(saveDraftAction).not.toHaveBeenCalled(); // back to the saved draft: nothing to save
  fireEvent.click(redoButton());
  expect(title().value).toBe("Crece con nosotros"); expect(redoButton()).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(saveDraftAction).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ blocks: expect.arrayContaining([expect.objectContaining({ type: "hero", content: expect.objectContaining({ title: "Crece con nosotros" }) })]) }) }));
});

it("handles Ctrl/⌘+Z, Ctrl/⌘+Shift+Z and Ctrl+Y on the page, and re-selects the changed section", async () => {
  await mount();
  const original = title().value;
  fireEvent.change(title(), { target: { value: "Uno" } });
  fireEvent.click(within(list()).getByRole("button", { name: "Seleccionar Vacantes abiertas" }));
  expect(screen.getByRole("heading", { name: "Propiedades de Vacantes abiertas" })).toBeVisible();
  key(document.body, { key: "z", ctrlKey: true });
  expect(screen.getByRole("heading", { name: "Propiedades de Portada" })).toBeVisible();
  expect(title().value).toBe(original);
  key(document.body, { key: "Z", ctrlKey: true, shiftKey: true }); expect(title().value).toBe("Uno");
  key(document.body, { key: "z", metaKey: true }); expect(title().value).toBe(original);
  key(document.body, { key: "y", ctrlKey: true }); expect(title().value).toBe("Uno");
});

it("leaves Ctrl+Z native inside text fields and ignores shortcuts while a dialog is open", async () => {
  await mount(); const user = userEvent.setup();
  fireEvent.change(title(), { target: { value: "Uno" } });
  key(title(), { key: "z", ctrlKey: true });
  expect(title().value).toBe("Uno"); expect(undoButton()).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Agregar sección" }));
  const library = await screen.findByRole("dialog", { name: "Agregar sección" });
  key(library, { key: "z", ctrlKey: true }); key(document.body, { key: "z", ctrlKey: true });
  await user.click(within(library).getByRole("button", { name: "Cerrar biblioteca" }));
  expect(title().value).toBe("Uno");
});

it("a blur starts a new history step for the same field", async () => {
  await mount();
  const original = title().value;
  fireEvent.change(title(), { target: { value: "A" } });
  fireEvent.change(title(), { target: { value: "AB" } });
  fireEvent.blur(title()); fireEvent.focus(title());
  fireEvent.change(title(), { target: { value: "ABC" } });
  fireEvent.click(undoButton()); expect(title().value).toBe("AB");
  fireEvent.click(undoButton()); expect(title().value).toBe(original);
});

it("deletes at once without a confirmation and offers Deshacer in a toast that restores the section in place, selected", async () => {
  await mount();
  const before = names();
  const index = before.indexOf("Seleccionar Historia");
  fireEvent.click(within(row("Historia")).getByRole("menuitem", { name: "Eliminar" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(names()).not.toContain("Seleccionar Historia");
  expect(sileo.success).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Sección eliminada", button: { title: "Deshacer", onClick: expect.any(Function) } }));
  fireEvent.click(within(list()).getByRole("button", { name: "Seleccionar Vacantes abiertas" }));
  act(() => vi.mocked(sileo.success).mock.calls[0][0].button!.onClick());
  expect(names()).toEqual(before); expect(names()[index]).toBe("Seleccionar Historia");
  expect(screen.getByRole("heading", { name: "Propiedades de Historia" })).toBeVisible();
});

it("undoes a delete with Ctrl+Z as well", async () => {
  await mount();
  const before = names();
  fireEvent.click(within(row("Historia")).getByRole("menuitem", { name: "Eliminar" }));
  key(document.body, { key: "z", ctrlKey: true });
  expect(names()).toEqual(before);
  expect(screen.getByRole("heading", { name: "Propiedades de Historia" })).toBeVisible();
});

it("offers «Conservar mis cambios» on a save conflict and then overwrites with the local draft", async () => {
  let complete!: (result: SiteResult) => void;
  vi.mocked(saveDraftAction).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const props = await mount();
  vi.useFakeTimers();
  fireEvent.change(title(), { target: { value: "Mi versión" } });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  const current = { ...props.initialSite, draft_version: 9 };
  await act(async () => complete({ kind: "conflict", current }));
  expect(screen.getByRole("button", { name: "Cargar la versión más reciente" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Conservar mis cambios" }));
  const dialog = screen.getByRole("alertdialog", { name: "¿Conservar tus cambios?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Conservar mis cambios" }));
  expect(title().value).toBe("Mi versión");
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(saveDraftAction).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveDraftAction).mock.calls[1][0]).toMatchObject({ ifMatch: '"9"', body: { blocks: expect.arrayContaining([expect.objectContaining({ type: "hero", content: expect.objectContaining({ title: "Mi versión" }) })]) } });
  expect(screen.queryByRole("button", { name: "Conservar mis cambios" })).toBeNull();
});
