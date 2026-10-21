import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MovementBoard } from "./board";
import { loadBoardAction } from "./actions";
import { loadDraftPipelineAction, previewPipelineAction, saveDraftPipelineAction, type PipelinePreviewActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { editorFromPipeline, moveStageTo, toPutBody, type EditorPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { appliedImpactNotice, pipelineFailureNotice } from "@/features/employer-vacancies/stage-config/feedback";
import { notifyActionResult } from "@/components/feedback/notify";
import { boardFixture, vacancyId } from "./board-fixture";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), previewPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Only positioning/portal behavior is replaced; exercise product menu items and callbacks.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext(false);
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => { const [open, setOpen] = React.useState(false); return <Context.Provider value={open}><div onClick={() => setOpen(true)}>{children}</div></Context.Provider>; },
    DropdownMenuTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(render, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Context) ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuCheckboxItem: ({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: (value: boolean) => void; children: ReactNode }) => <button role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>{children}</button>,
    DropdownMenuItem: ({ children, disabled, onClick }: ComponentProps<"button">) => <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
const dnd = vi.hoisted(() => ({ props: {} as Record<string, (event: unknown) => void>, drags: new Map<string, boolean>(), drops: new Map<string, boolean>() }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: { children: ReactNode }) => { dnd.props = props; return <>{children}</>; },
  DragOverlay: ({ children }: { children: ReactNode }) => <div aria-hidden="true">{children}</div>,
  useDraggable: ({ id, disabled }: { id: string; disabled: boolean }) => { dnd.drags.set(id, disabled); return { attributes: { "aria-describedby": "column-dnd-instructions" }, listeners: {}, setNodeRef: () => {}, setActivatorNodeRef: () => {}, isDragging: false }; },
  useDroppable: ({ id, disabled }: { id: string; disabled: boolean }) => { dnd.drops.set(id, disabled); return { setNodeRef: () => {} }; },
  useSensors: () => [], useSensor: () => ({}), PointerSensor: {}, KeyboardSensor: {}, pointerWithin: vi.fn(), closestCorners: vi.fn(),
}));
function pipeline(): EditorPipeline & { retired: EditorPipeline["stages"] } {
  return { retired: [], version: "1", structure_locked: false, stages: [
    { id: "new", kind: "new", name: "Nuevos" }, { id: "screen", kind: "screening", name: "Screening" },
    { id: "ok", kind: "screening_ok", name: "Screening OK" }, { id: "process", kind: "in_process", name: "En proceso" },
    { id: "custom", kind: "custom", name: "Técnica" }, { id: "hire", kind: "placement", name: "Placement" },
  ], exit: { id: "exit", kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 5, nameMaxLength: 80 } };
}
function board(config = pipeline(), candidates = false) {
  return { ...boardFixture(), stages: config.stages.map(stage => ({ ...stage, count: candidates && stage.kind === "new" ? 1 : 0 })), exit: { ...config.exit, count: 0 }, participations: candidates ? boardFixture().participations : [] };
}
function reordered(key = "screen", index = 2) {
  return { ...pipeline(), version: "2", stages: moveStageTo(editorFromPipeline(pipeline()), key, index).stages.map(stage => ({ id: stage.id!, kind: stage.kind, name: stage.name })) };
}
const emptyImpact = { not_applicable: [], recovery_reassigned: [] };
const preview = () => ({ stages: reordered().stages, has_impact: true,
  not_applicable: [{ participation_id: "person", candidate: boardFixture().participations[0].candidate, stage_id: "ok" }], recovery_reassigned: [] });
beforeEach(() => {
  vi.resetAllMocks(); dnd.drags.clear(); dnd.drops.clear();
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board() });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: pipeline(), etag: '"pipeline-1"' });
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview: { stages: reordered().stages, ...emptyImpact, has_impact: false } });
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...reordered(), applied_impact: emptyImpact }, etag: '"pipeline-2"' });
});
afterEach(cleanup);
async function mount() { render(<MovementBoard vacancyId={vacancyId} />); await screen.findByRole("button", { name: "Reordenar Screening" }); }
function drop(id = "screen", target = "ok", keyboard = false) {
  act(() => dnd.props.onDragStart({ active: { id, data: { current: { type: "column" } } }, activatorEvent: { type: keyboard ? "keydown" : "pointerdown" } }));
  act(() => dnd.props.onDragEnd({ active: { id, data: { current: { type: "column" } } }, over: { id: target } }));
}
async function confirm() {
  const button = await screen.findByRole("button", { name: "Mover columna" });
  await act(async () => { fireEvent.click(button); });
  return button;
}
it.each([false, true])("finished process disables column menu and pointer/keyboard ordering (keyboard=%s)", async keyboard => {
  const current = board(); current.lifecycle = { ...current.lifecycle, publication: "closed", process: "finished" };
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: current });
  await mount();
  expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Orden de Screening" })).toBeDisabled();
  expect(dnd.drags.get("screen")).toBe(true);
  drop("screen", "ok", keyboard);
  expect(previewPipelineAction).not.toHaveBeenCalled(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
const order = () => screen.getAllByRole("heading", { level: 3, hidden: true }).map(heading => heading.textContent);
it.each(["drop", "keyboard", "menu"])("%s with candidates previews, keeps order, cancels without PUT and confirms once", async source => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(pipeline(), true) });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...pipeline(), structure_locked: true }, etag: '"pipeline-1"' });
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview: preview() });
  vi.mocked(saveDraftPipelineAction).mockReturnValue(new Promise(() => {}));
  await mount(); const original = order();
  const request = () => {
    if (source !== "menu") drop("screen", "ok", source === "keyboard");
    else { fireEvent.click(screen.getByRole("button", { name: "Orden de Screening" })); fireEvent.click(screen.getByRole("menuitem", { name: "Mover a la derecha" })); }
  };
  request();
  const dialog = await screen.findByRole("alertdialog", { name: "¿Mover la columna Screening?" });
  expect(dialog).toHaveAccessibleDescription("Ningún candidato cambia de columna. El nuevo orden aplica a los próximos movimientos.");
  expect(within(dialog).getByText("Queda después de Screening OK.")).toBeVisible();
  expect(previewPipelineAction).toHaveBeenCalledExactlyOnceWith({ draftId: vacancyId, body: toPutBody(editorFromPipeline(reordered())) });
  expect(within(dialog).getByText("Ana Pérez → Screening OK").closest('[data-slot="confirm-action-details"]')).not.toBeNull();
  expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled(); expect(order()).toEqual(original);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled(); expect(order()).toEqual(original);
  request(); const button = await confirm(); fireEvent.click(button);
  expect(saveDraftPipelineAction).toHaveBeenCalledExactlyOnceWith({ draftId: vacancyId, ifMatch: '"pipeline-1"', body: { ...toPutBody(editorFromPipeline(reordered())), confirm_impact: true } });
  expect(button).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  expect(document.getElementById("column-drag-custom")).toBeDisabled();
});
it("offers named 40px intermediate handles and fixes new, placement and exit", async () => {
  await mount();
  expect(screen.getAllByRole("button", { name: /^Reordenar / })).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Reordenar Técnica" })).toHaveClass("size-10", "focus-visible:opacity-100");
  expect(screen.getByRole("button", { name: "Reordenar Técnica" })).toHaveAttribute("aria-describedby", "column-dnd-instructions");
  act(() => dnd.props.onDragStart({ active: { id: "screen", data: { current: { type: "column" } } }, activatorEvent: { type: "pointerdown" } }));
  for (const id of ["new", "hire", "exit"]) { expect(dnd.drags.get(id)).toBe(true); expect(dnd.drops.get(id)).toBe(true); }
  expect(dnd.drops.get("ok")).toBe(false);
  for (const target of ["new", "hire", "exit"]) drop("screen", target);
  expect(previewPipelineAction).not.toHaveBeenCalled(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it.each([false, true])("allows reordering with arriving candidates regardless of structure_locked=%s", async structure_locked => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(pipeline(), true) });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...pipeline(), structure_locked }, etag: '"pipeline-1"' });
  await mount(); expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /Columnas bloqueadas/ })).not.toBeInTheDocument();
  drop(); await screen.findByRole("alertdialog"); expect(previewPipelineAction).toHaveBeenCalledTimes(1);
});
it("keyboard menu disables fixed endpoints and previews before confirmation", async () => {
  await mount(); const user = userEvent.setup();
  screen.getByRole("button", { name: "Orden de Screening" }).focus(); await user.keyboard("{Enter}");
  expect(screen.getByRole("menuitem", { name: "Mover a la izquierda" })).toBeDisabled();
  screen.getByRole("menuitem", { name: "Mover a la derecha" }).focus(); await user.keyboard("{Enter}");
  await screen.findByRole("alertdialog"); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await confirm(); await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
});
it("last intermediate column moves left but never beyond Placement", async () => {
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Orden de Técnica" }));
  expect(screen.getByRole("menuitem", { name: "Mover a la derecha" })).toBeDisabled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Mover a la izquierda" }));
  await confirm(); expect(saveDraftPipelineAction).toHaveBeenCalledWith(expect.objectContaining({ body: { ...toPutBody(moveStageTo(editorFromPipeline(pipeline()), "custom", 3)), confirm_impact: true } }));
});
it("blocks double preview and all column controls while awaiting the read-only preview", async () => {
  let resolve!: (result: PipelinePreviewActionResult) => void;
  vi.mocked(previewPipelineAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  await mount(); const original = order(); drop(); drop();
  expect(previewPipelineAction).toHaveBeenCalledTimes(1); expect(order()).toEqual(original);
  expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeDisabled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await act(async () => resolve({ ok: true, preview: preview() }));
  expect(screen.getByRole("alertdialog")).toBeVisible(); expect(order()).toEqual(original);
});
it("success reloads board, adopts ETag and reports actual impact differences", async () => {
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview: preview() });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board() }).mockResolvedValue({ ok: true, data: board(reordered()) });
  await mount(); drop(); await confirm();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", description: expect.stringContaining(appliedImpactNotice(emptyImpact, preview()).description!) })));
  expect(order()).toEqual(reordered().stages.map(stage => stage.name).concat("Descartados"));
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(1);
  drop("screen", "process"); await confirm();
  expect(saveDraftPipelineAction).toHaveBeenLastCalledWith(expect.objectContaining({ ifMatch: '"pipeline-2"' }));
});
it("success counts applied candidates and announces the first reorderable slot", async () => {
  const first = reordered("custom", 1);
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...first, applied_impact: preview() }, etag: '"first"' });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board() }).mockResolvedValue({ ok: true, data: board(first) });
  await mount(); drop("custom", "screen"); await confirm();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", description: expect.stringContaining('1 candidato quedó con "No aplica"') })));
  expect(screen.getByText(/Técnica ahora va antes de Screening/)).toBeVisible();
});
it.each(["stage_occupied", "cutoff_stage_in_use", "impact_confirmation_required", "version_conflict", "no_response", "unrecognized_response", "server_error", "stage_change_requires_empty_pipeline"] as const)("PUT %s maps its cause, reloads once and never retries", async reason => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason, reference: { status: 409 } });
  await mount(); drop(); await confirm();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: pipelineFailureNotice(reason).title })));
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2);
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1); expect(previewPipelineAction).toHaveBeenCalledTimes(1);
  expect(order()).toEqual(pipeline().stages.map(stage => stage.name).concat("Descartados"));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  drop(); await screen.findByRole("alertdialog");
  expect(previewPipelineAction).toHaveBeenCalledTimes(2); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it.each(["no_response", "stage_occupied", "cutoff_stage_in_use"] as const)("preview %s never writes and keeps the current board", async reason => {
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: false, reason, reference: { status: 409 } });
  await mount(); const original = order(); drop();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: reason === "no_response" ? "No pudimos revisar el impacto" : pipelineFailureNotice(reason).title })));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(order()).toEqual(original);
  expect(saveDraftPipelineAction).not.toHaveBeenCalled(); expect(previewPipelineAction).toHaveBeenCalledTimes(1);
  if (reason === "no_response") expect(screen.getByText(/No se guardó ningún cambio/)).toBeVisible();
});
it("failed reconciliation locks stale writes and retry only reads", async () => {
  await mount(); vi.mocked(saveDraftPipelineAction).mockRejectedValueOnce(new Error("network"));
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  drop(); await confirm(); await screen.findByRole("button", { name: "Actualizar columnas" });
  expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Actualizar columnas" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeEnabled());
  expect(screen.getByText("Columnas actualizadas. No repetimos el guardado.")).toBeVisible();
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1); expect(previewPipelineAction).toHaveBeenCalledTimes(1);
});
it("412 adopts a different server order and ETag", async () => {
  await mount(); const remote = reordered("custom", 1);
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: remote, etag: '"remote-8"' });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(remote) });
  vi.mocked(saveDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412 } });
  drop(); await confirm(); await waitFor(() => expect(order()).toEqual(remote.stages.map(stage => stage.name).concat("Descartados")));
  drop("custom", "screen"); await confirm(); expect(saveDraftPipelineAction).toHaveBeenLastCalledWith(expect.objectContaining({ ifMatch: '"remote-8"' }));
});
it("lifts the column, marks insertion and cancels dragging without preview or PUT", async () => {
  await mount(); act(() => dnd.props.onDragStart({ active: { id: "screen", data: { current: { type: "column" } } }, activatorEvent: { type: "pointerdown" } }));
  expect(screen.getByRole("region", { name: "Screening: 0 candidatos" })).toHaveClass("opacity-55", "motion-reduce:transition-none");
  act(() => dnd.props.onDragOver({ over: { id: "ok" } }));
  expect(screen.getByText("Insertar después de Screening OK")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Screening OK: 0 candidatos" })).toHaveClass("before:bg-primary", "before:-right-2");
  act(() => dnd.props.onDragCancel({})); expect(screen.queryByText("Insertar después de Screening OK")).not.toBeInTheDocument();
  expect(previewPipelineAction).not.toHaveBeenCalled(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("failed initial config offers read-only recovery, not a false candidate restriction", async () => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(pipeline(), true) });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<MovementBoard vacancyId={vacancyId} />); await screen.findByRole("button", { name: "Actualizar columnas" });
  expect(screen.queryByRole("button", { name: /Columnas bloqueadas/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Reordenar / })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeEnabled();
});
it("large impact uses one scrolling details slot with official header/media/footer composition", async () => {
  const impact = preview();
  impact.not_applicable = Array.from({ length: 50 }, (_, index) => ({ ...impact.not_applicable[0], participation_id: `person-${index}`, candidate: { id: `candidate-${index}`, full_name: `Nombre extenso del candidato ${index}` } }));
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview: impact });
  await mount(); drop(); const dialog = await screen.findByRole("alertdialog");
  const details = dialog.querySelector('[data-slot="confirm-action-details"]')!;
  expect(dialog.querySelectorAll('[data-slot="confirm-action-details"]')).toHaveLength(1);
  expect(details).toHaveClass("overflow-y-auto");
  expect(details.querySelectorAll('[data-slot="item"]')).toHaveLength(50);
  expect(details.querySelector('[data-slot="card"]')).toHaveClass("shrink-0");
  expect(dialog.querySelector('[data-slot="alert-dialog-header"] [data-slot="alert-dialog-media"]')).not.toBeNull();
  expect(details.nextElementSibling).toHaveAttribute("data-slot", "alert-dialog-footer");
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("empty impact still names the proposed position and cancellation never writes", async () => {
  await mount(); drop(); const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Queda después de Screening OK.")).toBeVisible();
  expect(within(dialog).queryByText("No aplica por cambio de proceso")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("thrown preview failure is read-only, explicitly safe to review again", async () => {
  vi.mocked(previewPipelineAction).mockRejectedValueOnce(new Error("network"));
  await mount(); drop(); await screen.findByText(/No se guardó ningún cambio/);
  expect(loadBoardAction).toHaveBeenCalledTimes(1); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  expect(previewPipelineAction).toHaveBeenCalledTimes(1);
});
it("invalid editor structure blocks even a delivered drag callback", async () => {
  const invalid = pipeline(); invalid.stages = invalid.stages.filter(stage => stage.kind !== "in_process");
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(invalid) });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: invalid, etag: '"invalid"' });
  await mount(); drop(); expect(previewPipelineAction).not.toHaveBeenCalled(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
