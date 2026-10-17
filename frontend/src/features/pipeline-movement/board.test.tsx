import type { ReactNode, ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { loadBoardAction, loadHistoryAction, loadParticipationAction, moveParticipationAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { Board, FailureReason, Move, Result } from "./model";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Only the portal boundary is replaced: test product menu composition and actions,
// not Base UI positioning (the real menu/keyboard boundary needs browser review).
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} onClick={() => setOpen(true)}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: React.ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, onClick, disabled }: ComponentProps<"button">) => <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
const drag = vi.hoisted(() => ({ props: {} as Record<string, (event: unknown) => void>, drops: new Map<string, boolean>() }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: { children: ReactNode }) => { drag.props = props; return <>{children}</>; },
  DragOverlay: ({ children }: { children: ReactNode }) => <div aria-hidden="true">{children}</div>,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, setActivatorNodeRef: () => {}, isDragging: false }),
  useDroppable: ({ id, disabled }: { id: string; disabled: boolean }) => { drag.drops.set(id, disabled); return { setNodeRef: () => {}, isOver: false }; },
  useSensors: () => [], useSensor: () => ({}), PointerSensor: {}, KeyboardSensor: {}, pointerWithin: vi.fn(), closestCorners: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks(); drag.drops.clear();
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardFixture() });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  vi.mocked(moveParticipationAction).mockImplementation(async input => ({ ok: true, data: { ...boardFixture().participations[0], stage_id: (input.body as { to_stage_id: string }).to_stage_id, version: "5", etag: '"next-tag"', coverage: boardFixture().coverage } }));
});
afterEach(cleanup);
async function mount(board?: Board) {
  if (board) vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board });
  const view = render(<MovementBoard vacancyId={vacancyId} />);
  await screen.findByRole("heading", { name: "Entrada" });
  return view;
}
function menu() { fireEvent.click(screen.getByRole("button", { name: "Mover a… Ana Pérez" })); return screen.getByRole("menu"); }
function move(label = "Revisión") { fireEvent.click(within(menu()).getByRole("menuitem", { name: label })); }

it("menu lists exactly next forward and any earlier target, never current, skipped or exit", async () => {
  const board = boardFixture(); board.participations[0].stage_id = "interview";
  await mount(board);
  expect(within(menu()).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Entrada", "Revisión", "Contratación"]);
});
it("disables non-adjacent forward columns and the exit as drop targets", async () => {
  await mount();
  act(() => drag.props.onDragStart({ active: { id: "person" }, activatorEvent: { type: "pointerdown" } }));
  expect(drag.drops.get("screen")).toBe(false);
  expect(drag.drops.get("interview")).toBe(true);
  expect(drag.drops.get("hire")).toBe(true);
  expect(drag.drops.get("exit")).toBe(true);
  expect(screen.getByRole("region", { name: "Entrevista: 0 candidatos" })).toHaveAttribute("data-drop-disabled", "true");
  act(() => drag.props.onDragEnd({ active: { id: "person" }, over: { id: "interview" } }));
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("confirms leaving Placement with reduced coverage and retained history before sending true", async () => {
  const board = boardFixture(); board.participations[0].stage_id = "hire"; board.coverage.covered = 1;
  await mount(board); move();
  const dialog = await screen.findByRole("dialog", { name: "Salir de Contratación" });
  expect(dialog).toHaveTextContent("reduce las plazas cubiertas"); expect(dialog).toHaveTextContent("conserva el historial");
  expect(moveParticipationAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar movimiento" }));
  await screen.findByText("Candidato movido");
  expect(moveParticipationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: '"opaque-item-tag"', body: { to_stage_id: "screen", confirm_placement_exit: true } });
});
it("also requests explicit Placement confirmation after the server's 409", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason: "placement_exit_confirmation_required", reference: { status: 409 } });
  await mount(); move();
  const dialog = await screen.findByRole("dialog");
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar movimiento" }));
  await screen.findByText("Candidato movido");
  expect(moveParticipationAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: { to_stage_id: "screen", confirm_placement_exit: true } }));
});
it("412 reloads once and explains the other user's move", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } });
  await mount(); move();
  expect(await screen.findByText("Otro usuario movió a este candidato. Actualizamos el tablero.")).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 412 }) }));
});
it.each(["uncertain", "no_response", "unrecognized_response", "not_found"] as const)("%s reloads exactly once without retrying the move", async reason => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  await mount(); move();
  expect(await screen.findByText(/No repetimos el movimiento/)).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(moveParticipationAction).toHaveBeenCalledTimes(1);
});
it.each([
  ["board_too_large", "Hay demasiados candidatos"], ["vacancy_not_published", "Esta vacante no está publicada"], ["server_error", "No pudimos cargar el tablero"],
] as const)("board %s has an explicit read-only retry", async (reason, title) => {
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  render(<MovementBoard vacancyId={vacancyId} />);
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Entrada" });
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("sheet displays screening, stage names, timeline badges/actors/dates and a private CV download link", async () => {
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(await within(sheet).findByText("¿Disponibilidad?")).toBeVisible();
  for (const copy of ["Inmediata", "¿Por qué te interesa?", "Quiero aportar al equipo.", "Postulación recibida", "Entrevista → Contratación", "Contratación → Revisión", "Contratación registrada", "Salida registrada", "Ana Pérez · Candidato", "Luis López · Reclutador"]) expect(within(sheet).getAllByText(copy).length).toBeGreaterThan(0);
  expect(within(sheet).getByRole("link", { name: /CV Ana.pdf/ })).toHaveAttribute("href", `/api/company/vacancies/${vacancyId}/participations/person/cv`);
  expect(within(sheet).getByRole("link", { name: /CV Ana.pdf/ })).toHaveAttribute("download");
  expect(sheet.querySelectorAll("time").length).toBe(4);
  expect(loadParticipationAction).toHaveBeenCalledExactlyOnceWith(vacancyId, "person");
  expect(loadHistoryAction).toHaveBeenCalledExactlyOnceWith(vacancyId, "person");
});
it.each([2, null])("coverage copy with required %s; milestone remains visible after departures", async required => {
  const board = boardFixture(); board.coverage = { covered: 1, required, full_coverage_reached_at: "2026-10-16T12:00:00Z" };
  await mount(board);
  expect(screen.getByText(required === null ? "1 plazas cubiertas" : "1 de 2 plazas cubiertas")).toBeVisible();
  expect(screen.getByText(/Cobertura completa alcanzada/)).toBeVisible();
  if (required !== null) expect(screen.getByRole("progressbar", { name: "Cobertura de plazas" })).toHaveAttribute("aria-valuenow", "50");
});
it("loads a skeleton then keeps friendly empty columns and read-only exit", async () => {
  let resolve!: (value: Result<Board>) => void;
  vi.mocked(loadBoardAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { container } = render(<MovementBoard vacancyId={vacancyId} />);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando tablero");
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  const board = boardFixture(); board.participations = []; board.stages[0].count = 0;
  await act(async () => resolve({ ok: true, data: board }));
  expect(screen.getAllByText("Sin candidatos todavía")).toHaveLength(5);
  expect(screen.getByText("Los candidatos aparecerán aquí cuando la vacante reciba postulaciones.")).toBeVisible();
  expect(screen.getByText("Solo lectura")).toBeVisible(); expect(notifyActionResult).not.toHaveBeenCalled();
});
it("200 applies new stage, counts, etag and server coverage; double submission is locked", async () => {
  let resolve!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  await mount(); move();
  expect(screen.getByRole("button", { name: "Mover a… Ana Pérez" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Mover a… Ana Pérez" }));
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, data: { ...boardFixture().participations[0], stage_id: "screen", version: "5", etag: '"new-opaque"', coverage: { covered: 1, required: 2, full_coverage_reached_at: null } } }));
  expect(screen.getByRole("region", { name: "Revisión: 1 candidatos" })).toHaveTextContent("Ana Pérez");
  expect(screen.getByRole("region", { name: "Entrada: 0 candidatos" })).not.toHaveTextContent("Ana Pérez");
  expect(screen.getByText("1 de 2 plazas cubiertas")).toBeVisible();
  move("Entrada"); await screen.findByText("Candidato movido");
  expect(moveParticipationAction).toHaveBeenLastCalledWith(expect.objectContaining({ etag: '"new-opaque"' }));
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it.each(["stage_skip_not_allowed", "validation_error", "vacancy_not_published"] as FailureReason[])("%s leaves board unchanged with persistent feedback", async reason => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason, reference: { status: 409 } });
  await mount(); move();
  await screen.findByRole("status");
  expect(screen.getByRole("region", { name: "Entrada: 1 candidatos" })).toHaveTextContent("Ana Pérez");
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});
it("failed reconciliation locks stale writes and offers a read-only retry", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason: "uncertain", reference: {} });
  await mount(); vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }); move();
  await screen.findByRole("button", { name: "Reintentar" });
  expect(screen.getByRole("button", { name: "Mover a… Ana Pérez" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Tablero actualizado");
  expect(moveParticipationAction).toHaveBeenCalledTimes(1); expect(loadBoardAction).toHaveBeenCalledTimes(3);
});
it("restores keyboard focus to the moved card's menu", async () => {
  await mount();
  screen.getByRole("button", { name: "Mover a… Ana Pérez" }).focus();
  move();
  await screen.findByText("Candidato movido");
  expect(screen.getByRole("button", { name: "Mover a… Ana Pérez" })).toHaveFocus();
});
it("overlapping moves reconcile global coverage once after both responses, without replay", async () => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "second", candidate: { id: "second-candidate", full_name: "Eva Ruiz" } });
  board.stages[0].count = 2;
  let first!: (value: Result<Move>) => void, second!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { first = yes; })).mockReturnValueOnce(new Promise(yes => { second = yes; }));
  await mount(board); move();
  expect(screen.getByRole("button", { name: "Mover a… Eva Ruiz" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Mover a… Eva Ruiz" }));
  const menus = screen.getAllByRole("menu");
  fireEvent.click(within(menus[menus.length - 1]).getByRole("menuitem", { name: "Revisión" }));
  const refreshed = { ...board, coverage: { covered: 2, required: 2, full_coverage_reached_at: "2026-10-18T12:00:00Z" } };
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: refreshed });
  await act(async () => second({ ok: true, data: { ...board.participations[1], stage_id: "screen", coverage: refreshed.coverage } }));
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  await act(async () => first({ ok: true, data: { ...board.participations[0], stage_id: "screen", coverage: { ...board.coverage, covered: 1 } } }));
  expect(loadBoardAction).toHaveBeenCalledTimes(2);
  expect(screen.getByText("2 de 2 plazas cubiertas")).toBeVisible();
  expect(moveParticipationAction).toHaveBeenCalledTimes(2);
});
it.each(["success", "uncertain"])("another candidate's %s does not dismiss Placement confirmation; stale confirmation is blocked and cancel never writes", async outcome => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "second", stage_id: "hire", candidate: { id: "second-candidate", full_name: "Eva Ruiz" } });
  let resolve!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  await mount(board); move();
  fireEvent.click(screen.getByRole("button", { name: "Mover a… Eva Ruiz" }));
  const menus = screen.getAllByRole("menu");
  fireEvent.click(within(menus[menus.length - 1]).getByRole("menuitem", { name: "Revisión" }));
  await screen.findByRole("dialog", { name: "Salir de Contratación" });
  if (outcome === "uncertain") vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  await act(async () => resolve(outcome === "success" ? { ok: true, data: { ...board.participations[0], stage_id: "screen", coverage: board.coverage } } : { ok: false, reason: "uncertain", reference: {} }));
  const dialog = screen.getByRole("dialog", { name: "Salir de Contratación" });
  expect(dialog).toHaveTextContent("Eva Ruiz");
  if (outcome === "uncertain") {
    expect(within(dialog).getByRole("button", { name: "Confirmar movimiento" })).toBeDisabled();
    expect(dialog).toHaveTextContent("Cancela y usa Reintentar");
  }
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("sheet has independent loading/error/retry without reloading board or moving", async () => {
  vi.mocked(loadHistoryAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  fireEvent.click(await within(sheet).findByRole("button", { name: "Reintentar" }));
  expect(await within(sheet).findByText("Entrevista → Contratación")).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(1); expect(loadHistoryAction).toHaveBeenCalledTimes(2);
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
