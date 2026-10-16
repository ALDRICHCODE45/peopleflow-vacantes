import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDraftPipelineAction, saveDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import type { DraftPipelineActionFailure, DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { addCustomStage, editorFromPipeline, renameStage, toPutBody } from "@/features/jobs/drafts/pipeline/editor-model";
import { PipelineStageEditor } from "./editor";
import { pipelineFixture } from "./test-fixture";

vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const field = (position: number | "exit") => screen.getByRole("textbox", {
  name: position === "exit" ? "Nombre de la columna de salida" : `Nombre de la columna ${position}`,
});
const save = () => screen.getByRole("button", { name: "Guardar cambios" });
const actionStatus = () => within(document.querySelector("[data-pf-action-status-slot]") as HTMLElement).getByRole("status");
const edit = (position: number | "exit" = 2, name = "Filtro") => fireEvent.change(field(position), { target: { value: name } });
function mount(pipeline = pipelineFixture()) {
  return render(<PipelineStageEditor draftId={draftId} pipeline={pipeline} etag={'"pipeline-0"'} />);
}
function response(version = "1", name = "Filtro"): DraftPipelineActionResult {
  const pipeline = pipelineFixture();
  pipeline.version = version;
  pipeline.stages[1].name = name;
  return { ok: true, pipeline, etag: `"pipeline-${version}"` };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveDraftPipelineAction).mockResolvedValue(response());
  vi.mocked(loadDraftPipelineAction).mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom has no layout. Supply only real row geometry; dnd-kit's sensors,
// collision detection and keyboard events stay unmocked.
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

it("gives only movable rows a named, focus-visible, handle-only drag button", () => {
  mount();
  expect(screen.getAllByRole("button", { name: /^Arrastrar / })).toHaveLength(3);
  for (const name of ["Screening", "Screening OK", "En proceso"]) {
    const handle = screen.getByRole("button", { name: `Arrastrar ${name}` });
    expect(handle).toHaveClass("size-10", "touch-none", "focus-visible:ring-3");
    expect(handle).toHaveAttribute("aria-roledescription", "Columna del pipeline");
  }
  expect(screen.queryByRole("button", { name: /Arrastrar Nuevos|Arrastrar Placement|Arrastrar Descartados/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Agregar columna" }));
  edit(5, "Técnica");
  expect(screen.getByRole("button", { name: "Arrastrar Técnica" })).toBeEnabled();
});

it("uses outlined rows and legible medallions, including the exit, without primary-colored text", () => {
  const { container } = mount();
  for (const row of container.querySelectorAll('[data-slot="item"]')) {
    expect(row).toHaveAttribute("data-variant", "outline");
    expect(row).not.toHaveClass("bg-muted/50");
  }
  for (const media of container.querySelectorAll('[data-slot="item-media"]')) {
    expect(media).toHaveClass("size-10", "rounded-full", "bg-primary/12", "text-foreground", "ring-1", "ring-primary/40");
    expect(media).not.toHaveClass("text-primary");
  }
  const preview = screen.getByRole("region", { name: "Vista previa" });
  expect(preview.querySelectorAll('[data-slot="card"]')).toHaveLength(6);
  for (const card of preview.querySelectorAll('[data-slot="card"]')) {
    expect(card).toHaveClass("bg-card");
    expect(card).not.toHaveClass("bg-muted", "text-primary");
  }
});

it("reorders with space, arrow down, space; announces in Spanish and updates preview and dirty state", async () => {
  measureRows();
  const user = userEvent.setup(); mount();
  const handle = screen.getByRole("button", { name: "Arrastrar Screening" });
  handle.focus();
  expect(handle).toHaveAccessibleDescription(expect.stringMatching(/espacio.*flechas.*Escape/));
  await user.keyboard("[Space]");
  await waitFor(() => expect(screen.getByText("Tomaste Screening")).toBeInTheDocument());
  await user.keyboard("[ArrowDown]");
  await waitFor(() => expect(screen.getByText("Screening sobre la posición 3")).toBeInTheDocument());
  await user.keyboard("[Space]");
  await waitFor(() => expect(field(3)).toHaveValue("Screening"));
  expect(save()).toBeEnabled();
  expect(handle).toHaveFocus();
  expect(screen.getByText("Soltaste Screening en la posición 3")).toBeInTheDocument();
  const preview = screen.getByRole("list", { name: "Orden de las columnas" });
  expect(within(preview).getAllByRole("heading").map(node => node.textContent)).toEqual(["Nuevos", "Screening OK", "Screening", "En proceso", "Placement"]);
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});

it.each([
  ["En proceso", "[ArrowDown]", 4],
  ["Screening", "[ArrowUp]", 2],
])("refuses a keyboard drop of %s on a fixed endpoint", async (name, arrow, position) => {
  measureRows(); const user = userEvent.setup(); mount();
  screen.getByRole("button", { name: `Arrastrar ${name}` }).focus();
  await user.keyboard("[Space]"); await user.keyboard(arrow); await user.keyboard("[Space]");
  expect(field(position)).toHaveValue(name);
  expect(save()).toBeDisabled();
  expect(screen.getByText(new RegExp(`${name} no se movió`))).toBeInTheDocument();
});

it.each([false, true])("pointer drag is handle-only and dropping outside=%s respects the order", async outside => {
  measureRows(); const user = userEvent.setup(); mount();
  // A movement beginning in the field never activates the row's drag.
  await user.pointer([{ keys: "[MouseLeft>]", target: field(2), coords: { x: 250, y: 140 } },
    { coords: { x: 250, y: 340 } }, { keys: "[/MouseLeft]" }]);
  expect(field(2)).toHaveValue("Screening"); expect(save()).toBeDisabled();
  const handle = screen.getByRole("button", { name: "Arrastrar Screening" });
  await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { x: 570, y: 140 } },
    { coords: { x: 570, y: 160 } },
    { coords: outside ? { x: 900, y: 900 } : { x: 570, y: 340 } }]);
  expect(handle).toHaveAttribute("aria-pressed", "true");
  await user.pointer({ keys: "[/MouseLeft]" });
  expect(field(outside ? 2 : 4)).toHaveValue("Screening");
  if (outside) expect(save()).toBeDisabled();
  else expect(save()).toBeEnabled();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});

it("moves several rows in either direction with the keyboard", async () => {
  measureRows(); const user = userEvent.setup(); mount();
  screen.getByRole("button", { name: "Arrastrar Screening" }).focus();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowDown]"); await user.keyboard("[ArrowDown]"); await user.keyboard("[Space]");
  expect(field(4)).toHaveValue("Screening");
  await user.keyboard("[Space]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[ArrowUp]"); await user.keyboard("[Space]");
  expect(field(2)).toHaveValue("Screening"); expect(save()).toBeDisabled();
});

it("cancels a keyboard drag without editing", async () => {
  measureRows(); const user = userEvent.setup(); mount();
  screen.getByRole("button", { name: "Arrastrar Screening" }).focus();
  await user.keyboard("[Space]"); await user.keyboard("[ArrowDown]"); await user.keyboard("[Escape]");
  expect(field(2)).toHaveValue("Screening"); expect(save()).toBeDisabled();
  expect(screen.getByText("Cancelaste el movimiento de Screening")).toBeInTheDocument();
});

it("composes ordered Item rows, fixed endpoints, a preview and an initially empty status slot", () => {
  const { container } = mount();
  const progression = screen.getByRole("list", { name: "Columnas del pipeline" });
  expect(progression.tagName).toBe("OL");
  expect(within(progression).getAllByRole("listitem")).toHaveLength(5);
  expect(within(progression).getAllByRole("textbox").map(input => (input as HTMLInputElement).value)).toEqual(["Nuevos", "Screening", "Screening OK", "En proceso", "Placement"]);
  expect(container.querySelectorAll('li[data-slot="item"]')).toHaveLength(5);
  expect(screen.getAllByText("Posición fija")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Subir Nuevos|Bajar Placement|Quitar/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  const slot = container.querySelector("[data-pf-action-status-slot]")!;
  expect(slot).toBeEmptyDOMElement();
  expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const preview = screen.getByRole("region", { name: "Vista previa" });
  const variants = ["info", "review", "accent", "review", "success", "danger"];
  within(preview).getAllByText(/Nuevos|Screening|En proceso|Placement|Descartados/).filter(node => node.hasAttribute("data-slot")).forEach((badge, index) => {
    expect(badge).toHaveAttribute("data-variant", variants[index]);
    expect(badge).not.toHaveAttribute("data-dot");
  });
  expect(save()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeDisabled();
});
it("names the exit field apart from the progression and marks it with an exit icon, not a delete icon", () => {
  mount();
  const exit = screen.getByRole("region", { name: "Salida del proceso" });
  expect(within(exit).getByRole("textbox", { name: "Nombre de la columna de salida" })).toHaveValue("Descartados");
  expect(screen.queryByRole("textbox", { name: "Nombre de la columna 6" })).not.toBeInTheDocument();
  expect(exit.querySelector(".lucide-log-out")).not.toBeNull();
  expect(exit.querySelector(".lucide-trash-2, .lucide-trash2")).toBeNull();
});
it("renames, previews unsaved changes, and discards back to baseline", () => {
  mount(); edit();
  const preview = screen.getByRole("region", { name: "Vista previa" });
  expect(within(preview).getByText("Filtro")).toBeVisible();
  expect(within(screen.getByRole("list", { name: "Columnas del pipeline" })).getByText("Screening").closest('[data-slot="badge"]')).toHaveAttribute("data-variant", "review");
  expect(save()).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
  expect(field(2)).toHaveValue("Screening"); expect(save()).toBeDisabled();
});
it("moves both ways without crossing fixed columns", () => {
  mount();
  expect(screen.getByRole("button", { name: "Subir Screening" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Bajar En proceso" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Bajar Screening" }));
  expect(field(3)).toHaveValue("Screening");
  fireEvent.click(screen.getByRole("button", { name: "Subir Screening" }));
  expect(field(2)).toHaveValue("Screening");
});
it("uses limits 2/10, focuses new columns, keeps custom neutral, and only removes customs", () => {
  const pipeline = pipelineFixture(); pipeline.limits = { maxCustomStages: 2, nameMaxLength: 10 };
  mount(pipeline);
  expect(screen.getByText("0 de 2 columnas propias")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Agregar columna" }));
  expect(field(5)).toHaveFocus(); edit(5, "Técnica");
  fireEvent.click(screen.getByRole("button", { name: "Agregar columna" }));
  expect(field(6)).toHaveFocus(); edit(6, "Entrevista");
  expect(screen.getByRole("button", { name: "Agregar columna" })).toBeDisabled();
  expect(screen.getByText("Llegaste al máximo de 2 columnas propias.")).toBeVisible();
  expect(screen.getByText("2 de 2 columnas propias")).toBeVisible();
  for (const badge of screen.getAllByText("Columna propia")) {
    expect(badge).toHaveAttribute("data-variant", "neutral"); expect(badge).not.toHaveAttribute("data-dot");
  }
  expect(screen.getAllByRole("button", { name: /^Quitar / })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Quitar Técnica" }));
  expect(screen.getByRole("button", { name: "Agregar columna" })).toBeEnabled();
  expect(field(6)).toHaveValue("Placement");
  edit(5, "x".repeat(11)); fireEvent.blur(field(5));
  expect(screen.getByText("Usa como máximo 10 caracteres.")).toBeVisible();
});
it.each([
  ["", "Escribe un nombre para la columna."],
  ["x".repeat(41), "Usa como máximo 40 caracteres."],
  ["Bad\u0000", "Quita los caracteres no válidos."],
  [" descartados ", "Ya hay otra columna con este nombre."],
])("shows %j only after blur, associates FieldError, and sends nothing invalid", async (name, message) => {
  const { container } = mount(); edit(2, name);
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  fireEvent.blur(field(2));
  expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error");
  expect(field(2)).toHaveAttribute("aria-invalid", "true");
  expect(field(2)).toHaveAccessibleDescription(message);
  expect(container.querySelector('[data-slot="field"][data-invalid="true"]')).not.toBeNull();
  fireEvent.click(save());
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Revisa los datos marcados" }));
  if (name.includes("descartados")) expect(screen.getAllByText(message)).toHaveLength(2);
});
it("marks an untouched invalid added field when save is attempted", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar columna" })); fireEvent.click(save());
  expect(screen.getByText("Escribe un nombre para la columna.")).toBeVisible();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("sends exactly the normalized PUT body/current etag, adopts server ids and the next etag", async () => {
  const pipeline = pipelineFixture();
  const state = addCustomStage(renameStage(editorFromPipeline(pipeline), "s", " Filtro "), " Técnica ");
  const saved = { ...pipeline, version: "1", stages: state.stages.map(({ id, kind, name }) => ({ id: id ?? "server-custom", kind, name: name.trim() })) };
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: saved, etag: '"next"' });
  mount(); edit(2, " Filtro "); fireEvent.click(screen.getByRole("button", { name: "Agregar columna" })); edit(5, " Técnica ");
  fireEvent.click(save());
  await waitFor(() => expect(save()).toBeDisabled());
  expect(saveDraftPipelineAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"pipeline-0"', body: toPutBody(state) });
  expect(field(5)).toHaveValue("Técnica"); expect(actionStatus()).toHaveTextContent("Guardado");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "pipeline-save", type: "success", title: "Pipeline guardado", description: "Las columnas de esta vacante quedaron guardadas." }));
  edit(5, "Entrevista"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftPipelineAction).mock.calls[1][0]).toMatchObject({ ifMatch: '"next"', body: { stages: expect.arrayContaining([{ id: "server-custom", name: "Entrevista" }]) } });
});
it("shows Spinner while pending, prevents repeated clicks and never retries automatically", async () => {
  let resolve!: (value: DraftPipelineActionResult) => void;
  vi.mocked(saveDraftPipelineAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = mount(); edit(); fireEvent.click(save());
  const pending = screen.getByRole("button", { name: "Guardando…" }); expect(pending).toBeDisabled();
  expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Arrastrar Filtro" })).toBeDisabled();
  fireEvent.click(pending); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: false, reason: "no_response", reference: {} }));
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it("never labels later edits as saved and keeps the status associated below the actions", async () => {
  mount(); edit(); fireEvent.click(save()); await screen.findByText("Guardado");
  edit(2, "Otro filtro");
  expect(actionStatus()).toHaveTextContent("Cambios sin guardar");
  expect(save()).toHaveAttribute("aria-describedby", actionStatus().id);
});
it("emits info, not success, when the server returns the baseline version", async () => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue(response("0")); mount(); edit(); fireEvent.click(save());
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" })));
  expect(save()).toBeDisabled();
});
it.each([
  [4, "Entrevistas", "Sigue siendo la etapa donde se registran los subestados del proceso."],
  [5, "Contratado", "Sigue siendo la etapa de contratación: mover a un candidato aquí cuenta como contratación."],
  ["exit" as const, "Fuera", "Sigue siendo la salida para descartar candidatos desde cualquier etapa."],
])("confirms the critical rename at %s; review, escape and close send nothing", async (position, name, description) => {
  const user = userEvent.setup(); mount(); edit(position, name); fireEvent.click(save());
  const dialog = await screen.findByRole("dialog", { name: "Confirmar cambio de nombre" });
  expect(within(dialog).getByText(description)).toBeVisible();
  expect(within(dialog).getByText(new RegExp(`→ ${name}`))).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Revisar" }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await user.click(save()); await user.keyboard("{Escape}");
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await user.click(save()); await user.click(screen.getByRole("button", { name: "Cerrar" }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await user.click(save());
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
});
it("keeps conflicting edits until an explicit reload replaces them", async () => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue(response("2", "Actual"));
  mount(); edit(); fireEvent.click(save());
  const reload = await screen.findByRole("button", { name: "Cargar versión actual" });
  expect(field(2)).toHaveValue("Filtro"); expect(loadDraftPipelineAction).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Esto cambió en otro lugar", action: expect.objectContaining({ title: "Cargar versión actual" }), reference: expect.objectContaining({ status: 412, at: expect.any(String) }) }));
  let resolve!: (value: DraftPipelineActionResult) => void;
  vi.mocked(loadDraftPipelineAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  fireEvent.click(reload);
  expect(screen.getByRole("button", { name: "Arrastrar Filtro" })).toBeDisabled();
  expect(field(2)).toHaveValue("Filtro");
  await act(async () => resolve(response("2", "Actual")));
  await waitFor(() => expect(field(2)).toHaveValue("Actual")); expect(save()).toBeDisabled();
});
it.each(["no_response", "server_error", "unrecognized_response", "precondition_required"] as const)("%s is uncertain: keeps edits, explains safety and offers Comprobar", async reason => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason, reference: { status: 500 } });
  mount(); edit(); fireEvent.click(save());
  await screen.findByRole("button", { name: "Comprobar" }); expect(field(2)).toHaveValue("Filtro");
  expect(loadDraftPipelineAction).not.toHaveBeenCalled(); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description: expect.stringMatching(/No sabemos si.*guard/i), action: expect.objectContaining({ title: "Comprobar" }) }));
});
it.each(["saved", "not_saved", "conflict"] as const)("Comprobar reconciles %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValue(response());
  vi.mocked(loadDraftPipelineAction).mockResolvedValue(outcome === "saved" ? response() : outcome === "conflict" ? response("2", "Ajeno") : { ok: true, pipeline: pipelineFixture(), etag: '"unexpected-tag"' });
  mount(); edit(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  if (outcome === "saved") {
    await waitFor(() => expect(save()).toBeDisabled()); expect(actionStatus()).toHaveTextContent("Guardado");
  } else if (outcome === "not_saved") {
    await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro.");
    expect(field(2)).toHaveValue("Filtro"); expect(save()).toBeEnabled();
    fireEvent.click(save()); await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveDraftPipelineAction).mock.calls[1][0].ifMatch).toBe('"pipeline-0"');
  } else {
    await screen.findByRole("button", { name: "Cargar versión actual" }); expect(field(2)).toHaveValue("Filtro");
  }
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(outcome === "not_saved" ? 2 : 1);
});
it("retains the form and recovery action if the reconciliation GET fails", async () => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } });
  mount(); edit(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  await waitFor(() => expect(loadDraftPipelineAction).toHaveBeenCalledTimes(1));
  expect(field(2)).toHaveValue("Filtro"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
});
it.each([
  ["unauthenticated", "Tu sesión expiró", "/empresa/login"],
  ["forbidden", "No tienes permiso para esta acción", undefined],
  ["not_found", "No encontramos este borrador", undefined],
  ["company_inactive", "Falta configurar tu empresa", "/empresa/configuracion"],
  ["company_not_active", "Falta configurar tu empresa", "/empresa/configuracion"],
  ["validation_error", "Revisa los datos marcados", undefined],
  ["invalid_request", "Revisa los datos marcados", undefined],
  ["payload_too_large", "El pipeline supera el tamaño permitido", undefined],
] as const)("%s preserves edits and uses cause-specific feedback/reference", async (reason, title, href) => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: reason as DraftPipelineActionFailure["reason"], reference: { status: 400, code: reason } });
  mount(); edit(); fireEvent.click(save());
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "pipeline-save", type: "error", title, reference: expect.objectContaining({ status: 400, code: reason, at: expect.any(String) }) })));
  expect(field(2)).toHaveValue("Filtro"); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  if (href) expect(within(actionStatus()).getByRole("link")).toHaveAttribute("href", href);
});
