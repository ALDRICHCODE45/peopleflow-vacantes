import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { loadDraftSubstatesAction, saveDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import { fromCatalog, rename, toPutBody, type SubstatesCatalog } from "@/features/jobs/drafts/pipeline/substates-model";
import { notifyActionResult } from "@/components/feedback/notify";
import { SubstatesSheet } from "./sheet";
import { populatedSubstates, substatesFixture } from "./test-fixture";

vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Exercise the real editor callbacks at the menu portal boundary; rows still render unmocked UI.
const rowBoundary = vi.hoisted(() => new Map<string, { onMove: (direction: "up" | "down") => void; onRemove: () => void }>());
vi.mock("./row", async importOriginal => {
  const actual = await importOriginal<typeof import("./row")>();
  return { ...actual, SubstateRow: (props: Parameters<typeof actual.SubstateRow>[0]) => {
    rowBoundary.set(props.entry.key, props);
    return <actual.SubstateRow {...props} />;
  } };
});
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const onSaved = vi.fn();
const onClose = vi.fn();
const field = (n = 1) => screen.getByRole("textbox", { name: `Nombre del subestado ${n}` });
const save = () => screen.getByRole("button", { name: "Guardar subestados" });
const change = (name = "Entrevista", n = 1) => fireEvent.change(field(n), { target: { value: name } });
const success = (version = "1", name = "Entrevista"): DraftSubstatesActionResult => ({ ok: true, catalog: { ...substatesFixture(), version, substates: [{ id: "server", name }] }, etag: `"substates-${version}"` });
function Harness({ initial = substatesFixture(), name = "Entrevistas" }: { initial?: SubstatesCatalog; name?: string }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState({ catalog: initial, etag: '"substates-0"' });
  return <><button onClick={() => setOpen(true)}>Abrir</button><SubstatesSheet draftId={draftId} inProcessName={name} {...saved} open={open}
    onOpenChange={(value: boolean) => { onClose(value); setOpen(value); }} onSaved={(catalog: SubstatesCatalog, etag: string) => { onSaved(catalog, etag); setSaved({ catalog, etag }); }} /></>;
}
const mount = (catalog = substatesFixture(), name?: string) => render(<Harness initial={catalog} name={name} />);
function add(name = "Entrevista") { fireEvent.click(screen.getByRole("button", { name: "Agregar subestado" })); change(name); }
const status = () => within(document.querySelector("[data-pf-action-status-slot]") as HTMLElement).getByRole("status");
beforeEach(() => { vi.resetAllMocks(); rowBoundary.clear(); vi.mocked(saveDraftSubstatesAction).mockResolvedValue(success()); vi.mocked(loadDraftSubstatesAction).mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("composes an accessible right Sheet with one left-aligned suggestions row and a reserved status below its actions", () => {
  mount();
  const dialog = screen.getByRole("dialog", { name: "Subestados de Entrevistas" });
  expect(within(dialog).getByRole("heading", { name: "Subestados de Entrevistas" })).toBeVisible();
  expect(dialog).toHaveAttribute("data-side", "right");
  expect(dialog).toHaveAccessibleDescription("Úsalos para registrar en qué punto del proceso está cada candidato, por ejemplo cada entrevista. No son pasos obligatorios ni tienen que seguir un orden.");
  expect(screen.getByText("0 de 50 subestados")).toHaveAttribute("data-variant", "neutral");
  expect(screen.getByText("Todavía no hay subestados. Elige una sugerencia o agrega uno.")).toBeVisible();
  expect(dialog.querySelector('[data-slot="empty"]')).toBeNull();
  const suggestions = screen.getByRole("region", { name: "Sugerencias" });
  const buttons = within(suggestions).getAllByRole("button");
  expect(buttons).toHaveLength(4);
  expect(buttons.every(button => button.parentElement === buttons[0].parentElement)).toBe(true);
  expect(buttons[0].parentElement).toHaveClass("flex", "flex-wrap", "gap-2");
  expect(buttons[0]).toHaveClass("min-h-10");
  const slot = dialog.querySelector("[data-pf-action-status-slot]")!;
  expect(slot).toBeEmptyDOMElement(); expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(save()).toBeDisabled();
});
it.each(["  Entrevistas\u00a0 técnicas  ", "  "])("normalizes the current column title %j, with a semantic fallback", name => {
  mount(substatesFixture(), name);
  expect(screen.getByRole("dialog", { name: name.trim() ? "Subestados de Entrevistas técnicas" : "Subestados de En proceso" })).toBeVisible();
});
it("filters suggestions against unsaved names and preserves the available suggestions above the list", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar Primera entrevista" }));
  expect(field()).toHaveValue("Primera entrevista"); expect(field()).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Agregar Primera entrevista" })).not.toBeInTheDocument();
  change(" SEGUNDA\u00a0 entrevista ");
  expect(screen.queryByRole("button", { name: "Agregar Segunda entrevista" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agregar Primera entrevista" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Sugerencias" }).compareDocumentPosition(screen.getByRole("list", { name: "Subestados" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it("hides suggestions when exhausted and respects dynamic limits", () => {
  mount({ ...substatesFixture(), suggestions: ["Técnica"], limits: { maxSubstates: 1, nameMaxLength: 10 } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar Técnica" }));
  expect(screen.queryByText("Sugerencias")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agregar subestado" })).toBeDisabled();
  expect(screen.getByText("Llegaste al máximo de 1 subestados.")).toBeVisible();
});
it.each([["", "Escribe un nombre para el subestado."], ["x".repeat(41), "Usa como máximo 40 caracteres."], ["Bad\u0000", "Quita los caracteres no válidos."], [" técnica ", "Ya hay otro subestado con este nombre."]])("validates %j inline and prevents invalid requests", (name, message) => {
  mount(populatedSubstates()); change(name); fireEvent.blur(field());
  expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error");
  expect(field()).toHaveAttribute("aria-invalid", "true"); expect(field()).toHaveAccessibleDescription(message);
  fireEvent.click(save()); expect(saveDraftSubstatesAction).not.toHaveBeenCalled(); expect(field()).toHaveFocus();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", title: "Revisa los datos marcados" }));
});
it("validates an untouched new entry on save", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar subestado" })); fireEvent.click(save());
  expect(screen.getByText("Escribe un nombre para el subestado.")).toBeVisible(); expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it("sends exactly toPutBody with the current ETag, closes on confirmed save and reopens from the saved catalog", async () => {
  mount(populatedSubstates()); change(" Entrevista ");
  const expected = toPutBody(rename(fromCatalog(populatedSubstates()), "one", " Entrevista "));
  const catalog = { ...populatedSubstates(), version: "2", substates: expected.substates as SubstatesCatalog["substates"] };
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: true, catalog, etag: '"substates-2"' });
  fireEvent.click(save());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(saveDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"substates-0"', body: expected });
  expect(onSaved).toHaveBeenCalledWith(catalog, '"substates-2"'); expect(onClose).toHaveBeenCalledWith(false);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", type: "success", title: "Subestados guardados" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir" })); expect(field()).toHaveValue("Entrevista"); expect(save()).toBeDisabled();
  change("Otra"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftSubstatesAction).mock.calls[1][0].ifMatch).toBe('"substates-2"');
});
it("omits ids for new entries and reports info on a no-op version", async () => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue(success("0")); mount(); add(" Entrevista "); fireEvent.click(save());
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" })));
  expect(saveDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"substates-0"', body: { substates: [{ name: "Entrevista" }] } });
});
it("keeps version-conflict edits until an explicit reload and adopts its ETag", async () => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } });
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue(success("2", "Ajena")); mount(); add(); fireEvent.click(save());
  const reload = await screen.findByRole("button", { name: "Cargar versión actual" });
  expect(field()).toHaveValue("Entrevista"); expect(loadDraftSubstatesAction).not.toHaveBeenCalled(); fireEvent.click(reload);
  await waitFor(() => expect(field()).toHaveValue("Ajena")); expect(save()).toBeDisabled();
  change("Otra"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftSubstatesAction).mock.calls[1][0].ifMatch).toBe('"substates-2"');
});
it.each(["saved", "not_saved", "conflict"] as const)("Comprobar reconciles %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue(outcome === "saved" ? success() : outcome === "conflict" ? success("2", "Ajena") : { ok: true, catalog: substatesFixture(), etag: '"substates-0"' });
  mount(); add(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  if (outcome === "saved") await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  else {
    if (outcome === "conflict") await screen.findByRole("button", { name: "Cargar versión actual" });
    else await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro.");
    expect(field()).toHaveValue("Entrevista");
  }
  expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(1); expect(loadDraftSubstatesAction).toHaveBeenCalledTimes(1);
});
it("retains recovery after a failed GET and does not automatically retry thrown writes", async () => {
  vi.mocked(saveDraftSubstatesAction).mockRejectedValue(new Error("unsafe"));
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } });
  mount(); add(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  await screen.findByText("No se pudo cargar · tus cambios siguen aquí"); expect(field()).toHaveValue("Entrevista"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
  expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(1);
});
it.each(["Cancelar", "Cerrar subestados", "Escape", "overlay"])("confirms unsaved close from %s; continuing preserves edits and discarding resets on reopen", async method => {
  const user = userEvent.setup(); mount(); add();
  if (method === "Escape") await user.keyboard("[Escape]");
  else if (method === "overlay") await user.click(document.querySelector('[data-slot="sheet-overlay"]')!);
  else fireEvent.click(screen.getByRole("button", { name: method }));
  const confirmation = await screen.findByRole("dialog", { name: "¿Descartar los cambios de subestados?" });
  expect(confirmation).toHaveAccessibleDescription("Los subestados que no guardaste se perderán. Las columnas no cambian.");
  expect(onClose).not.toHaveBeenCalled(); fireEvent.click(within(confirmation).getByRole("button", { name: "Seguir editando" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "¿Descartar los cambios de subestados?" })).not.toBeInTheDocument());
  expect(field()).toHaveValue("Entrevista");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Abrir" })); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(save()).toBeDisabled();
  expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it("closes directly without changes", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
});
it("blocks closing and concurrent mutations while saving", async () => {
  let resolve!: (value: DraftSubstatesActionResult) => void;
  vi.mocked(saveDraftSubstatesAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const user = userEvent.setup(); mount(); add(); fireEvent.click(save());
  expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled(); expect(field()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Cerrar subestados" })).toBeDisabled();
  expect(document.querySelector('[data-slot="spinner"]')).not.toBeNull();
  await user.keyboard("[Escape]"); await user.click(document.querySelector('[data-slot="sheet-overlay"]')!);
  expect(onClose).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog", { name: "¿Descartar los cambios de subestados?" })).not.toBeInTheDocument();
  await act(async () => resolve(success())); expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(1);
});
it("moves in either direction and removes all entries, allowing an empty catalog save", async () => {
  const catalog = populatedSubstates();
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: true, catalog: { ...catalog, version: "2", substates: [] }, etag: '"substates-2"' });
  mount(catalog);
  act(() => rowBoundary.get("one")!.onMove("down")); expect(field(2)).toHaveValue("Primera entrevista");
  act(() => rowBoundary.get("one")!.onMove("up")); expect(field()).toHaveValue("Primera entrevista"); expect(save()).toBeDisabled();
  act(() => rowBoundary.get("one")!.onRemove()); expect(field()).toHaveValue("Técnica");
  expect(screen.getByRole("button", { name: "Agregar Primera entrevista" })).toBeVisible();
  act(() => { rowBoundary.get("two")!.onRemove(); rowBoundary.get("three")!.onRemove(); });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(save()).toBeEnabled();
  fireEvent.click(save()); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(saveDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"substates-0"', body: { substates: [] } });
});
it("keeps action status and field state inside the Sheet on failure", async () => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: { status: 401, code: "unauthenticated" } });
  mount(); add(); fireEvent.click(save());
  await waitFor(() => expect(status()).toHaveTextContent("Iniciar sesión"));
  expect(field()).toHaveValue("Entrevista"); expect(save()).toHaveAttribute("aria-describedby", status().id);
  expect(within(status()).getByRole("link")).toHaveAttribute("href", "/empresa/login");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", type: "error", title: "Tu sesión expiró", reference: expect.objectContaining({ status: 401, at: expect.any(String) }) }));
});
