import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDraftSubstatesAction, saveDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import type { DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { SubstatesEditor } from "./editor";
import { substateRowActions } from "./row";
import { fromCatalog } from "@/features/jobs/drafts/pipeline/substates-model";
import { populatedSubstates, substatesFixture } from "./test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const field = (n = 1) => screen.getByRole("textbox", { name: `Nombre del subestado ${n}` });
const save = () => screen.getByRole("button", { name: "Guardar cambios" });
const change = (name = "Entrevista", n = 1) => fireEvent.change(field(n), { target: { value: name } });
const mount = (catalog = substatesFixture()) => render(<SubstatesEditor draftId={draftId} inProcessName="Entrevistas" catalog={catalog} etag={'"substates-0"'} />);
const success = (version = "1", name = "Entrevista"): DraftSubstatesActionResult => ({ ok: true, catalog: { ...substatesFixture(), version, substates: [{ id: "server", name }] }, etag: `"substates-${version}"` });
const status = () => within(document.querySelector("[data-pf-action-status-slot]") as HTMLElement).getByRole("status");
beforeEach(() => { vi.resetAllMocks(); vi.mocked(saveDraftSubstatesAction).mockResolvedValue(success()); vi.mocked(loadDraftSubstatesAction).mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function add(name = "Entrevista") { fireEvent.click(screen.getByRole("button", { name: "Agregar subestado" })); change(name); }

it("composes one Card with a real h3, neutral counter, Empty, suggestions and a reserved status below actions", () => {
  const { container } = mount();
  expect(screen.getByRole("heading", { level: 3, name: "Subestados de Entrevistas" })).toBeVisible();
  expect(screen.getByText("Úsalos para registrar en qué punto del proceso está cada candidato, por ejemplo cada entrevista. No son pasos obligatorios ni tienen que seguir un orden.")).toBeVisible();
  expect(screen.getByText("0 de 50 subestados")).toHaveAttribute("data-variant", "neutral");
  expect(screen.getByRole("heading", { name: "Todavía no hay subestados" })).toBeVisible();
  expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /^Agregar / })).toHaveLength(5);
  expect(screen.queryByText("Vista previa")).not.toBeInTheDocument();
  const slot = container.querySelector("[data-pf-action-status-slot]")!;
  expect(slot).toBeEmptyDOMElement(); expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(save()).toBeDisabled();
});
it("adds suggestions without saving, hides those already in the editor, focuses new inputs, and discards", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar Primera entrevista" }));
  expect(field()).toHaveValue("Primera entrevista"); expect(field()).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Agregar Primera entrevista" })).not.toBeInTheDocument();
  expect(screen.queryByText("Todavía no hay subestados")).not.toBeInTheDocument(); expect(save()).toBeEnabled();
  expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
  expect(screen.getByRole("button", { name: "Agregar Primera entrevista" })).toBeVisible(); expect(save()).toBeDisabled();
});
it("hides the entire suggestions block when all are present and honors dynamic limits", () => {
  mount({ ...substatesFixture(), limits: { maxSubstates: 1, nameMaxLength: 10 }, suggestions: ["Técnica"] });
  fireEvent.click(screen.getByRole("button", { name: "Agregar Técnica" }));
  expect(screen.queryByText("Sugerencias")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agregar subestado" })).toBeDisabled();
  expect(screen.getByText("Llegaste al máximo de 1 subestados.")).toBeVisible();
});
it("orders outlined Item rows with handle before the shared legible medallion and one ellipsis menu", () => {
  const { container } = mount(populatedSubstates());
  const list = screen.getByRole("list", { name: "Subestados" }); expect(list.tagName).toBe("OL");
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  for (const row of container.querySelectorAll('li[data-slot="item"]')) {
    expect(row).toHaveAttribute("data-variant", "outline"); expect(row).not.toHaveClass("bg-muted");
    const handle = within(row as HTMLElement).getByRole("button", { name: /^Arrastrar / });
    const media = row.querySelector('[data-slot="item-media"]')!;
    expect(handle).toHaveClass("size-10", "touch-none"); expect(handle.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(media).toHaveClass("bg-primary/12", "text-foreground", "ring-primary/40"); expect(media).not.toHaveClass("text-primary");
    const trigger = within(row as HTMLElement).getByRole("button", { name: /^Acciones de / });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu"); expect(trigger.querySelector(".lucide-ellipsis")).not.toBeNull();
  }
});
it("offers Subir/Bajar at either endpoint and a free remove action for every substate", () => {
  const state = fromCatalog(populatedSubstates());
  expect(substateRowActions(state, "one")).toEqual([{ id: "up", label: "Subir", disabled: true }, { id: "down", label: "Bajar", disabled: false }, { id: "remove", label: "Quitar subestado", disabled: false }]);
  expect(substateRowActions(state, "three")).toEqual([{ id: "up", label: "Subir", disabled: false }, { id: "down", label: "Bajar", disabled: true }, { id: "remove", label: "Quitar subestado", disabled: false }]);
});
it.each([["", "Escribe un nombre para el subestado."], ["x".repeat(41), "Usa como máximo 40 caracteres."], ["Bad\u0000", "Quita los caracteres no válidos."], [" técnica ", "Ya hay otro subestado con este nombre."]])("validates %j after blur and prevents invalid requests", (name, message) => {
  mount(populatedSubstates()); change(name); expect(screen.queryByText(message)).not.toBeInTheDocument(); fireEvent.blur(field());
  expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error"); expect(field()).toHaveAttribute("aria-invalid", "true"); expect(field()).toHaveAccessibleDescription(message);
  fireEvent.click(save()); expect(saveDraftSubstatesAction).not.toHaveBeenCalled(); expect(field()).toHaveFocus();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", title: "Revisa los datos marcados" }));
});
it("marks an untouched empty addition on save", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar subestado" })); fireEvent.click(save());
  expect(screen.getByText("Escribe un nombre para el subestado.")).toBeVisible(); expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it("sends normalized names without new ids, adopts server ids/current ETag and never opens a rename dialog", async () => {
  mount(); add(" Entrevista "); fireEvent.click(save());
  await waitFor(() => expect(save()).toBeDisabled());
  expect(saveDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"substates-0"', body: { substates: [{ name: "Entrevista" }] } });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", type: "success", title: "Subestados guardados" }));
  change("Otra"); expect(status()).toHaveTextContent("Cambios sin guardar"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftSubstatesAction).mock.calls[1][0]).toEqual({ draftId, ifMatch: '"substates-1"', body: { substates: [{ id: "server", name: "Otra" }] } });
});
it("shows Spinner and prevents concurrent mutation while saving", async () => {
  let resolve!: (value: DraftSubstatesActionResult) => void;
  vi.mocked(saveDraftSubstatesAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = mount(); add(); fireEvent.click(save());
  const pending = screen.getByRole("button", { name: "Guardando…" }); expect(pending).toBeDisabled();
  expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull(); expect(field()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Arrastrar Entrevista" })).toBeDisabled(); fireEvent.click(pending);
  await act(async () => resolve(success())); expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(1);
});
it("reports info on a no-op version", async () => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue(success("0")); mount(); add(); fireEvent.click(save());
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" })));
});
it("keeps conflict edits until an explicit reload", async () => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } });
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue(success("2", "Ajena")); mount(); add(); fireEvent.click(save());
  const reload = await screen.findByRole("button", { name: "Cargar versión actual" });
  expect(field()).toHaveValue("Entrevista"); expect(loadDraftSubstatesAction).not.toHaveBeenCalled(); fireEvent.click(reload);
  await waitFor(() => expect(field()).toHaveValue("Ajena")); expect(save()).toBeDisabled();
});
it.each(["saved", "not_saved", "conflict"] as const)("Comprobar reconciles %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue(outcome === "saved" ? success() : outcome === "conflict" ? success("2", "Ajena") : { ok: true, catalog: substatesFixture(), etag: '"different"' });
  mount(); add(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  if (outcome === "saved") await waitFor(() => expect(save()).toBeDisabled());
  else if (outcome === "conflict") await screen.findByRole("button", { name: "Cargar versión actual" });
  else await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro.");
  expect(saveDraftSubstatesAction).toHaveBeenCalledTimes(1); expect(field()).toHaveValue("Entrevista");
});
it("retains recovery after a failed GET and handles thrown writes safely", async () => {
  vi.mocked(saveDraftSubstatesAction).mockRejectedValue(new Error("unsafe"));
  vi.mocked(loadDraftSubstatesAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } });
  mount(); add(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  await screen.findByText("No se pudo cargar · tus cambios siguen aquí"); expect(field()).toHaveValue("Entrevista"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
});
it.each([
  ["unauthenticated", "Tu sesión expiró", "/empresa/login"], ["forbidden", "No tienes permiso para esta acción", undefined],
  ["not_found", "No encontramos este borrador", undefined], ["company_inactive", "Falta configurar tu empresa", "/empresa/configuracion"],
  ["company_not_active", "Falta configurar tu empresa", "/empresa/configuracion"], ["validation_error", "Revisa los datos marcados", undefined],
  ["invalid_request", "Revisa los datos marcados", undefined], ["payload_too_large", "El catálogo supera el tamaño permitido", undefined],
  ["server_error", "El servidor tuvo un problema", undefined], ["unrecognized_response", "No pudimos confirmar el resultado", undefined],
  ["precondition_required", "No pudimos confirmar el resultado", undefined],
] as const)("%s preserves edits and reports safe feedback", async (reason, title, href) => {
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: false, reason: reason as DraftPipelineActionFailure["reason"], reference: { status: 400, code: reason } });
  mount(); add(); fireEvent.click(save());
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "substates-save", type: "error", title, reference: expect.objectContaining({ status: 400, code: reason, at: expect.any(String) }) })));
  expect(field()).toHaveValue("Entrevista"); expect(save()).toHaveAttribute("aria-describedby", status().id);
  if (href) expect(within(status()).getByRole("link")).toHaveAttribute("href", href);
});
// Real dnd-kit sensors; jsdom supplies only row geometry (as in the columns editor).
function measureRows() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.matches('li[data-slot="item"]');
    const overlay = this.matches('div[data-slot="item"]') && this.parentElement?.style.position === "fixed";
    if (!row && !overlay) return original.call(this);
    const index = row ? Array.from(this.parentElement!.children).indexOf(this) : 0;
    const style = overlay ? this.parentElement!.style : this.style;
    const translation = style.transform.match(/translate3d\([^,]+,\s*([-\d.]+)px/);
    const top = row ? index * 100 : parseFloat(style.top) + Number(translation?.[1] ?? 0);
    return { x: 0, y: top, top, left: 0, bottom: top + 80, right: 600, width: 600, height: 80, toJSON: () => ({}) };
  });
}
it("moves to both endpoints using keyboard and cancels without editing", async () => {
  measureRows(); const user = userEvent.setup(); mount(populatedSubstates());
  const handle = screen.getByRole("button", { name: "Arrastrar Primera entrevista" }); handle.focus();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowDown]"); await user.keyboard("[ArrowDown]"); await user.keyboard("[Space]");
  expect(field(3)).toHaveValue("Primera entrevista"); expect(handle).toHaveFocus();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[Escape]"); expect(field(3)).toHaveValue("Primera entrevista");
  await user.keyboard("[Space]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[Space]");
  expect(field()).toHaveValue("Primera entrevista"); expect(save()).toBeDisabled(); expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it.each([false, true])("pointer drag is handle-only and outside=%s does not change order", async outside => {
  measureRows(); const user = userEvent.setup(); mount(populatedSubstates());
  await user.pointer([{ keys: "[MouseLeft>]", target: field(), coords: { x: 250, y: 40 } }, { coords: { x: 250, y: 240 } }, { keys: "[/MouseLeft]" }]);
  expect(save()).toBeDisabled();
  const handle = screen.getByRole("button", { name: "Arrastrar Primera entrevista" });
  await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { x: 20, y: 40 } }, { coords: { x: 20, y: 60 } }, { coords: outside ? { x: 900, y: 900 } : { x: 20, y: 240 } }]);
  await user.pointer({ keys: "[/MouseLeft]" }); expect(field(outside ? 1 : 3)).toHaveValue("Primera entrevista");
  if (outside) expect(save()).toBeDisabled(); else expect(save()).toBeEnabled();
});
