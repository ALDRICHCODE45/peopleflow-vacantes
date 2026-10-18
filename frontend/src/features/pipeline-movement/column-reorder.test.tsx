import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MovementBoard } from "./board";
import { loadBoardAction } from "./actions";
import { loadDraftPipelineAction, saveDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { editorFromPipeline, moveStageTo, toPutBody, type EditorPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { notifyActionResult } from "@/components/feedback/notify";
import { boardFixture, vacancyId } from "./board-fixture";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Replace only positioning/portal behavior; exercise product menu items and callbacks.
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
function pipeline(): EditorPipeline {
  return { version: "1", structure_locked: false, stages: [
    { id: "new", kind: "new", name: "Nuevos" },
    { id: "screen", kind: "screening", name: "Screening" },
    { id: "ok", kind: "screening_ok", name: "Screening OK" },
    { id: "process", kind: "in_process", name: "En proceso" },
    { id: "custom", kind: "custom", name: "Técnica" },
    { id: "hire", kind: "placement", name: "Placement" },
  ], exit: { id: "exit", kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 5, nameMaxLength: 80 } };
}
function board(config = pipeline()) {
  return { ...boardFixture(), stages: config.stages.map(stage => ({ ...stage, count: 0 })), exit: { ...config.exit, count: 0 }, participations: [] };
}
const saved = () => {
  const next = moveStageTo(editorFromPipeline(pipeline()), "screen", 2);
  return { ...pipeline(), version: "2", stages: next.stages.map(({ id, kind, name }) => ({ id: id!, kind, name })) };
};
beforeEach(() => {
  vi.resetAllMocks(); dnd.drags.clear(); dnd.drops.clear();
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board() });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: pipeline(), etag: '"pipeline-1"' });
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: saved(), etag: '"pipeline-2"' });
});
afterEach(cleanup);
async function mount() { render(<MovementBoard vacancyId={vacancyId} />); await screen.findByRole("button", { name: "Reordenar Screening" }); }
function drop(id = "screen", target = "ok") {
  act(() => dnd.props.onDragStart({ active: { id, data: { current: { type: "column" } } }, activatorEvent: { type: "pointerdown" } }));
  act(() => dnd.props.onDragEnd({ active: { id, data: { current: { type: "column" } } }, over: { id: target } }));
}
const order = () => screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent);
it("offers named handles only for intermediate progression columns", async () => {
  await mount();
  expect(screen.getAllByRole("button", { name: /^Reordenar / })).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Reordenar Técnica" })).toHaveClass("size-10", "focus-visible:opacity-100");
  expect(screen.getByRole("button", { name: "Reordenar Técnica" })).toHaveAttribute("aria-describedby", "column-dnd-instructions");
});
it("new, placement and exit are neither draggable nor column targets", async () => {
  await mount();
  act(() => dnd.props.onDragStart({ active: { id: "screen", data: { current: { type: "column" } } }, activatorEvent: { type: "pointerdown" } }));
  for (const id of ["new", "hire", "exit"]) { expect(dnd.drags.get(id)).toBe(true); expect(dnd.drops.get(id)).toBe(true); }
  expect(dnd.drops.get("ok")).toBe(false);
  act(() => dnd.props.onDragEnd({ active: { id: "screen", data: { current: { type: "column" } } }, over: { id: "exit" } }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("locked columns explain the candidate restriction without offering drag or a reorder menu", async () => {
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...pipeline(), structure_locked: true }, etag: '"locked"' });
  render(<MovementBoard vacancyId={vacancyId} />);
  const hint = await screen.findByRole("button", { name: "Columnas bloqueadas: Screening" });
  expect(hint).toHaveAttribute("aria-description", "Con candidatos en la vacante, las columnas solo se pueden renombrar.");
  expect(screen.queryByRole("button", { name: /^Reordenar / })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Orden de Screening" })).not.toBeInTheDocument();
  expect(dnd.drags.get("screen")).toBe(true);
});
it("the keyboard/non-drag menu moves right and disables movement beyond fixed endpoints", async () => {
  await mount();
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Orden de Screening" }).focus();
  await user.keyboard("{Enter}");
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Mover a la izquierda" })).toBeDisabled();
  within(menu).getByRole("menuitem", { name: "Mover a la derecha" }).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
});
it("drop saves the reordered full body with If-Match, optimistically orders and locks all column controls", async () => {
  let resolve!: (result: DraftPipelineActionResult) => void;
  vi.mocked(saveDraftPipelineAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  await mount(); drop();
  expect(order()).toEqual(saved().stages.map(stage => stage.name).concat("Descartados"));
  expect(saveDraftPipelineAction).toHaveBeenCalledExactlyOnceWith({ draftId: vacancyId, ifMatch: '"pipeline-1"', body: toPutBody(editorFromPipeline(saved())) });
  expect(screen.getByRole("button", { name: "Reordenar Técnica" })).toBeDisabled();
  drop("process", "custom"); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(saved()) });
  await act(async () => resolve({ ok: true, pipeline: saved(), etag: '"pipeline-2"' }));
});
it("success announces confirmation, reloads board order and adopts the next ETag", async () => {
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board() }).mockResolvedValue({ ok: true, data: board(saved()) });
  await mount(); drop();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Columnas reordenadas" })));
  expect(order()).toEqual(saved().stages.map(stage => stage.name).concat("Descartados"));
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(1);
  drop("screen", "process");
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenLastCalledWith(expect.objectContaining({ ifMatch: '"pipeline-2"' })));
});
it.each([
  ["stage_change_requires_empty_pipeline", 409, "La vacante ya tiene candidatos: las columnas solo se pueden renombrar."],
  ["version_conflict", 412, "Otro usuario cambió las columnas. Actualizamos el tablero."],
  ["no_response", undefined, "No pudimos confirmar el cambio. Actualizamos el tablero sin repetir el guardado."],
  ["unrecognized_response", undefined, "No pudimos confirmar el cambio. Actualizamos el tablero sin repetir el guardado."],
  ["server_error", 500, "No pudimos confirmar el cambio. Actualizamos el tablero sin repetir el guardado."],
] as const)("%s reloads config and board once, reverting without retry", async (reason, status, text) => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason, reference: { status } });
  await mount(); drop();
  expect(await screen.findByText(text)).toBeVisible();
  expect(order()).toEqual(pipeline().stages.map(stage => stage.name).concat("Descartados"));
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1); expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description: text }));
});
it("a failed reconciliation locks stale column writes; retry is read-only", async () => {
  await mount();
  vi.mocked(saveDraftPipelineAction).mockRejectedValueOnce(new Error("network"));
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  drop();
  await screen.findByRole("button", { name: "Actualizar columnas" });
  expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Actualizar columnas" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reordenar Screening" })).toBeEnabled());
  expect(screen.getByText("Columnas actualizadas. No repetimos el guardado.")).toBeVisible();
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it("lifts the column, marks the insertion side, and cancels without a PUT", async () => {
  await mount();
  act(() => dnd.props.onDragStart({ active: { id: "screen", data: { current: { type: "column" } } }, activatorEvent: { type: "pointerdown" } }));
  expect(screen.getByRole("region", { name: "Screening: 0 candidatos" })).toHaveClass("opacity-55", "motion-reduce:transition-none");
  act(() => dnd.props.onDragOver({ over: { id: "ok" } }));
  expect(screen.getByText("Insertar después de Screening OK")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Screening OK: 0 candidatos" })).toHaveClass("before:bg-primary", "before:-right-2");
  act(() => dnd.props.onDragCancel({}));
  expect(screen.queryByText("Insertar después de Screening OK")).not.toBeInTheDocument();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("the menu can also move left, and the last intermediate column cannot move right", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Orden de Técnica" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Mover a la derecha" })).toBeDisabled();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Mover a la izquierda" }));
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledWith(expect.objectContaining({ body: toPutBody(moveStageTo(editorFromPipeline(pipeline()), "custom", 3)) })));
});
it("never offers column drag when candidates arrive in an otherwise unlocked snapshot", async () => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: { ...board(), participations: boardFixture().participations } });
  render(<MovementBoard vacancyId={vacancyId} />);
  await screen.findByRole("button", { name: "Columnas bloqueadas: Screening" });
  expect(screen.queryByRole("button", { name: /^Reordenar / })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeEnabled();
});
it("candidate lock explanation remains available even if the pipeline config read fails", async () => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: { ...board(), participations: boardFixture().participations } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<MovementBoard vacancyId={vacancyId} />);
  expect(await screen.findByRole("button", { name: "Columnas bloqueadas: Screening" })).toHaveAttribute("aria-description", "Con candidatos en la vacante, las columnas solo se pueden renombrar.");
});
it("412 adopts a different server order and its ETag rather than merely restoring the baseline", async () => {
  await mount();
  const remote = { ...pipeline(), version: "8", stages: moveStageTo(editorFromPipeline(pipeline()), "custom", 1).stages.map(stage => ({ id: stage.id!, kind: stage.kind, name: stage.name })) };
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: true, pipeline: remote, etag: '\"remote-8\"' });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(remote) });
  vi.mocked(saveDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412 } });
  drop();
  await screen.findByText("Otro usuario cambió las columnas. Actualizamos el tablero.");
  expect(order()).toEqual(remote.stages.map(stage => stage.name).concat("Descartados"));
  drop("custom", "screen");
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenLastCalledWith(expect.objectContaining({ ifMatch: '\"remote-8\"' })));
});
it("409 replaces handles with locked explanations after candidates arrive on the server", async () => {
  await mount();
  vi.mocked(saveDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: "stage_change_requires_empty_pipeline", reference: { status: 409 } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: true, pipeline: { ...pipeline(), structure_locked: true }, etag: '\"locked-2\"' });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: { ...board(), participations: boardFixture().participations } });
  drop();
  await screen.findByText("La vacante ya tiene candidatos: las columnas solo se pueden renombrar.");
  expect(screen.queryByRole("button", { name: /^Reordenar / })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Columnas bloqueadas: Screening" })).toBeEnabled();
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it("invalid editor structure blocks writing even if a drag callback is delivered", async () => {
  const invalid = pipeline(); invalid.stages = invalid.stages.filter(stage => stage.kind !== "in_process");
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(invalid) });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: invalid, etag: '"invalid"' });
  await mount(); drop();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
