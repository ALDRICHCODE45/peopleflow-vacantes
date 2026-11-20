import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { discardParticipationAction, loadBoardAction, loadParticipationAction, moveParticipationAction } from "./actions";
import { loadReplacementSummaryAction } from "@/features/vacancy-replacement/actions";
import type { ChainSummary } from "@/features/vacancy-replacement/model";
import { notifyActionResult } from "@/components/feedback/notify";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import { boardFixture, detailFixture, vacancyId } from "./board-fixture";
import type { Board, Move } from "./model";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";

// replacement-processes-v1 «Departure on a finished process» (S3) and the card side of «Iniciar reemplazo» (S1/S6).
vi.mock("@/features/manual-intake/actions", () => ({ checkDuplicatesAction: vi.fn() }));
vi.mock("@/features/manual-intake/upload", () => ({ submitManualCandidate: vi.fn() }));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({ children }: { children: ReactNode }) => <>{children}</>, ComboboxInput: ({ id }: { id: string }) => <input id={id} />,
  ComboboxContent: () => null, ComboboxEmpty: () => null, ComboboxList: () => null, ComboboxItem: () => null, useComboboxAnchor: () => ({ current: null }),
}));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
vi.mock("@/features/vacancy-replacement/actions", () => ({ loadReplacementSummaryAction: vi.fn() }));
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn(), setParticipationSubstateAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Only the portal boundary: product menu composition (incl. link items), not Base UI positioning.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onClick={() => { if (!open) onOpenChange?.(true); setOpen(true); }}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <button role="menuitemradio" aria-checked="false">{children}</button>,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, onClick, disabled, render }: ComponentProps<"button"> & { render?: ReactElement<Record<string, unknown>> }) => render
      ? React.cloneElement(render, { role: "menuitem", children }) : <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
// The anchored popup only honours `open`; geometry/focus need browser review (as for the filter popover).
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  return {
    Popover: ({ open = false, children }: { open?: boolean; children: ReactNode }) => <Open.Provider value={open}>{children}</Open.Provider>,
    PopoverTrigger: ({ render }: { render: ReactElement }) => render,
    PopoverContent: ({ children, "aria-label": label }: { children: ReactNode; "aria-label"?: string }) => React.useContext(Open) ? <div role="dialog" aria-label={label}>{children}</div> : null,
    PopoverHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PopoverTitle: ({ children }: { children: ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  };
});
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>, DragOverlay: ({ children }: { children: ReactNode }) => <div aria-hidden="true">{children}</div>,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, setActivatorNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }), useSensors: () => [], useSensor: () => ({}), PointerSensor: {}, KeyboardSensor: {}, pointerWithin: vi.fn(), closestCorners: vi.fn(),
}));

const other = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const life = (patch: Partial<Lifecycle> = {}): Lifecycle => ({
  close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "2", published_at: null, paused_at: null,
  closed_at: "2026-11-03T12:00:00Z", process_finished_at: "2026-11-03T12:00:00Z", allowed_actions: [],
  kind: "original", sequence: null, replacement_of: null, root_process_id: vacancyId, visibility: "public", closed_covered: true,
  can_start_replacement: false, start_replacement_blocker: "no_startable_credits", startable_credits_count: 0, active_replacement_id: null, ...patch,
});
/** A hire in Placement on a closed vacancy (finished by default). */
function hireBoard(lifecycle: Lifecycle = life()): Board {
  const board = boardFixture();
  board.lifecycle = lifecycle;
  board.participations[0].stage_id = "hire";
  board.stages[0].count = 0; board.stages[3].count = 1;
  board.coverage = { covered: 2, required: 2, full_coverage_reached_at: "2026-10-29T12:00:00Z" };
  return board;
}
const leftAt = "2026-11-17T18:00:00Z";
const discard = { reason: { group: "candidate" as const, key: "no_longer_interested" as const }, previous_stage_id: "hire", recovery_stage_id: "hire", discarded_at: leftAt };
/** The board after the hire left: in Descartados, previous stage Placement. */
function departedBoard(lifecycle: Lifecycle): Board {
  const board = hireBoard(lifecycle);
  board.participations[0] = { ...board.participations[0], stage_id: "exit", discard, moved_at: leftAt };
  board.stages[3].count = 0; board.exit.count = 1; board.coverage = { covered: 1, required: 2, full_coverage_reached_at: "2026-10-29T12:00:00Z" };
  return board;
}
const startable = () => life({ can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1 });
/** What the board's single GET V/replacements leaves after the slim projection: the chain names and the startable credits by participation. */
const credit = { id: "credit-1", participationId: "person", hiredAt: "2026-10-22T12:00:00Z", leftAt };
const chainItems = (second: Partial<ChainSummary["items"][number]> = {}): ChainSummary["items"] => [
  { id: vacancyId, kind: "original", sequence: 0, title: "Supervisor(a) de Almacén", canOpen: true },
  { id: other, kind: "replacement", sequence: 1, title: "Supervisor(a) de Almacén", canOpen: true, ...second },
];
function departureResponse(lifecycle: Lifecycle): Move {
  const item = boardFixture().participations[0];
  return { ...item, stage_id: "exit", discard, moved_at: leftAt, version: "5", etag: '"next-tag"', coverage: { covered: 1, required: 2, full_coverage_reached_at: "2026-10-29T12:00:00Z" }, delivery: boardFixture().delivery, lifecycle } as Move;
}
function resolveSummary(credits: ChainSummary["credits"] = [credit], items: ChainSummary["items"] = chainItems()) {
  vi.mocked(loadReplacementSummaryAction).mockResolvedValue({ ok: true, data: { items, credits } });
}
function moveResponse(lifecycle: Lifecycle): Move {
  const item = boardFixture().participations[0];
  return { ...item, stage_id: "screen", moved_at: leftAt, version: "5", etag: '"next-tag"', coverage: { covered: 1, required: 2, full_coverage_reached_at: "2026-10-29T12:00:00Z" }, delivery: boardFixture().delivery, lifecycle } as Move;
}
async function mount(board: Board, onStartReplacement?: (creditId?: string) => void) {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  const view = render(<MovementBoard vacancyId={vacancyId} onStartReplacement={onStartReplacement} />);
  await screen.findByRole("heading", { name: "Entrada" });
  return view;
}
const trigger = () => screen.getByRole("button", { name: "Acciones de Ana Pérez" });
const openMenu = () => { fireEvent.click(trigger()); return screen.getByRole("menu"); };
const names = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map(item => item.textContent);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() }); });
afterEach(cleanup);

it("S3: a hire in Placement keeps a «⋯» menu with the single «No se sostuvo…» item on a finished board", async () => {
  await mount(hireBoard());
  expect(trigger()).toBeEnabled();
  expect(names(openMenu())).toEqual(["No se sostuvo…"]);
  expect(screen.queryByRole("button", { name: "Arrastrar Ana Pérez" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Agregar candidato" })).not.toBeInTheDocument();
});
it("S3: only a hire in Placement gets the late action; every other card stays read-only", async () => {
  const board = hireBoard(); board.participations[0].stage_id = "new"; board.stages[0].count = 1; board.stages[3].count = 0;
  await mount(board);
  expect(trigger()).toBeDisabled();
});
it("S3: the confirmation states the coverage before/after and that the original result does not change", async () => {
  await mount(hireBoard());
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "No se sostuvo…" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Marcar a Ana como «No se sostuvo»?" });
  expect(dialog).toHaveTextContent("El candidato se fue");
  expect(dialog).toHaveTextContent("2 de 2 → 1 de 2");
  expect(dialog).toHaveTextContent("Resultado original");
  expect(dialog).toHaveTextContent("Sin cambios");
  expect(discardParticipationAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(discardParticipationAction).not.toHaveBeenCalled();
});
it("S3: late departure on a finished board sends the discard body and refreshes lifecycle, coverage and the card", async () => {
  const start = vi.fn();
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: departureResponse(startable()) });
  resolveSummary();
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: startable() });
  await mount(hireBoard(), start);
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "No se sostuvo…" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Marcar a Ana como «No se sostuvo»?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Marcar «No se sostuvo»" }));
  await waitFor(() => expect(discardParticipationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: '"opaque-item-tag"', body: { reason: { group: "candidate", key: "no_longer_interested" }, placement_exit_reason: "candidate_left" } }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Ana Pérez quedó como «No se sostuvo»" })));
  expect(screen.queryByRole("dialog", { name: "¿Marcar a Ana como «No se sostuvo»?" })).not.toBeInTheDocument();
  // Coverage follows the confirmed write; everything else on the board stays read-only.
  expect(screen.getByText("1 de 2 plazas cubiertas")).toBeVisible();
  // The card now carries the badge and the departure date, and the menu offers the start with its credit.
  const badge = await screen.findByText("No se sostuvo", { selector: '[data-slot="badge"]' });
  expect(badge.closest("li")).toHaveTextContent(/se fue el 17 nov/);
  expect(loadReplacementSummaryAction).toHaveBeenCalledExactlyOnceWith(vacancyId);
  expect(loadParticipationAction).not.toHaveBeenCalled();
  expect(names(openMenu())).toEqual(["Iniciar reemplazo"]);
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(start).toHaveBeenCalledExactlyOnceWith("credit-1");
  expect(screen.queryByRole("button", { name: "Arrastrar Ana Pérez" })).not.toBeInTheDocument();
});
it("S3: the header «Acciones» menu offers «Iniciar reemplazo» once the departure made it startable", async () => {
  const start = vi.fn();
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: departureResponse(startable()) });
  resolveSummary();
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: startable() });
  await mount(hireBoard(), start);
  expect(screen.queryByRole("button", { name: "Acciones de la vacante" })).not.toBeInTheDocument();
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "No se sostuvo…" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Marcar «No se sostuvo»" }));
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de la vacante" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(start).toHaveBeenCalledExactlyOnceWith();
});
it("S3: a failed late departure leaves the hire where it was and explains it", async () => {
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
  await mount(hireBoard());
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "No se sostuvo…" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Marcar «No se sostuvo»" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No se marcó a Ana Pérez como «No se sostuvo»" })));
  expect(screen.getByRole("region", { name: "Contratación: 1 candidato" })).toBeVisible();
  expect(screen.queryByText("No se sostuvo", { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
});
it("S1: a startable departed card offers «Iniciar reemplazo» with its own credit", async () => {
  const start = vi.fn(); resolveSummary();
  await mount(departedBoard(startable()), start);
  expect(await screen.findByText("No se sostuvo", { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(names(openMenu())).toEqual(["Iniciar reemplazo"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(start).toHaveBeenCalledExactlyOnceWith("credit-1");
});
it("one GET V/replacements per board load resolves every departed card by participation_id, with the date the backend gives", async () => {
  const board = departedBoard(startable());
  board.participations.push({ ...board.participations[0], id: "luis", candidate: { id: "luis-candidate", full_name: "Luis Soto", kind: "organic" } });
  board.exit.count = 2;
  resolveSummary([{ id: "credit-1", participationId: "person", hiredAt: "2026-10-22T12:00:00Z", leftAt: "2026-11-16T18:00:00Z" }, { id: "credit-2", participationId: "luis", hiredAt: null, leftAt: null }]);
  const start = vi.fn();
  await mount(board, start);
  await waitFor(() => expect(screen.getAllByText("No se sostuvo", { selector: '[data-slot="badge"]' })).toHaveLength(2));
  expect(loadReplacementSummaryAction).toHaveBeenCalledTimes(1);
  expect(loadParticipationAction).not.toHaveBeenCalled();
  // The credit's own left_at wins; without it the discard date still says when.
  expect(screen.getByText("Ana Pérez").closest("li")).toHaveTextContent(/se fue el 16 nov/);
  expect(screen.getByText("Luis Soto").closest("li")).toHaveTextContent(/se fue el 17 nov/);
  fireEvent.click(screen.getByRole("button", { name: "Acciones de Luis Soto" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(start).toHaveBeenCalledExactlyOnceWith("credit-2");
});
it("S6: with a replacement active the contract lists no startable credit: the card offers nothing and the link bar leads to the replacement by name", async () => {
  resolveSummary([]);
  await mount(departedBoard(life({ can_start_replacement: false, start_replacement_blocker: "replacement_active", active_replacement_id: other })), vi.fn());
  expect(await screen.findByRole("link", { name: "Ver reemplazo activo: Reemplazo 1" })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
  expect(screen.queryByText("No se sostuvo", { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
  expect(trigger()).toBeDisabled();
});
it("a credit the backend does not list (voided, or already replaced) shows no badge", async () => {
  resolveSummary([]);
  await mount(departedBoard(startable()), vi.fn());
  await waitFor(() => expect(loadReplacementSummaryAction).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Ya no le interesa")).toBeVisible();
  expect(screen.queryByText("No se sostuvo", { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
  expect(trigger()).toBeDisabled();
});
it.each([
  ["answers ok: false", () => vi.mocked(loadReplacementSummaryAction).mockResolvedValue({ ok: false })],
  ["rejects", () => vi.mocked(loadReplacementSummaryAction).mockRejectedValue(new Error("network"))],
])("when the read %s the departed card keeps today's look: no badge, no start, no crash", async (_name, fail) => {
  fail();
  await mount(departedBoard(startable()), vi.fn());
  await waitFor(() => expect(loadReplacementSummaryAction).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Ya no le interesa")).toBeVisible();
  expect(screen.queryByText("No se sostuvo", { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
  expect(trigger()).toBeDisabled();
});
it("without a start handler the departed card has nothing to offer on a finished board", async () => {
  resolveSummary();
  await mount(departedBoard(startable()));
  await screen.findByText("No se sostuvo", { selector: '[data-slot="badge"]' });
  expect(trigger()).toBeDisabled();
});
it("an active (not finished) board also offers «No se sostuvo…» beside the usual actions", async () => {
  await mount(hireBoard(life({ publication: "published", process: "active", closed_at: null, process_finished_at: null, close_reason: null, closed_covered: false })), vi.fn());
  const labels = names(openMenu());
  expect(labels).toContain("No se sostuvo…"); expect(labels).toContain("Descartar"); expect(labels).toContain("Ver ficha");
});
it("old backend (no replacement keys): finished board stays read-only, no late action, no badge", async () => {
  const old = hireBoard(); old.lifecycle = { close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "2", published_at: null, paused_at: null, closed_at: null, process_finished_at: "2026-11-03T12:00:00Z", allowed_actions: [] };
  await mount(old, vi.fn());
  expect(trigger()).toBeDisabled();
});
it("old backend on an active board: no «No se sostuvo…» item and no replacement read for departed cards", async () => {
  const old = hireBoard(); old.lifecycle = { close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] };
  await mount(old, vi.fn());
  expect(names(openMenu())).not.toContain("No se sostuvo…");
  cleanup();
  const departed = departedBoard(old.lifecycle); departed.lifecycle = old.lifecycle;
  await mount(departed, vi.fn());
  expect(await screen.findByText("Ya no le interesa")).toBeVisible();
  expect(loadParticipationAction).not.toHaveBeenCalled();
  expect(loadReplacementSummaryAction).not.toHaveBeenCalled();
  expect(screen.queryByText("No se sostuvo", { selector: '[data-slot="badge"]' })).not.toBeInTheDocument();
});
it("S6: the board header links a replacement to its original and an original to its active replacement", async () => {
  await mount(hireBoard(life({ kind: "replacement", sequence: 1, replacement_of: other, visibility: "private", active_replacement_id: vacancyId, closed_covered: false, publication: "published", process: "active", closed_at: null, process_finished_at: null, close_reason: null })));
  expect(screen.getByRole("link", { name: /Ver original/ })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
  cleanup();
  await mount(hireBoard(life({ active_replacement_id: other })));
  expect(screen.getByRole("link", { name: /Ver reemplazo/ })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
});
it("S6: the link bar names the processes from the same single read that resolves the cards", async () => {
  const items: ChainSummary["items"] = [
    { id: other, kind: "original", sequence: 0, title: "Supervisor(a) de Almacén", canOpen: true },
    { id: vacancyId, kind: "replacement", sequence: 1, title: "Supervisor(a) de Almacén", canOpen: true },
  ];
  resolveSummary([credit], items);
  const board = departedBoard(life({ kind: "replacement", sequence: 1, replacement_of: other, visibility: "private", can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1, active_replacement_id: vacancyId }));
  await mount(board, vi.fn());
  expect(await screen.findByText("Reemplazo 1")).toBeVisible();
  expect(screen.getByText(/de Supervisor\(a\) de Almacén/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Ver original/ })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
  expect(await screen.findByText("No se sostuvo", { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(loadReplacementSummaryAction).toHaveBeenCalledTimes(1);
});
it("S6: an original with an active replacement names it in the link bar with one request, even with nobody departed", async () => {
  resolveSummary([]);
  await mount(hireBoard(life({ active_replacement_id: other })));
  expect(await screen.findByRole("link", { name: "Ver reemplazo activo: Reemplazo 1" })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
  expect(loadReplacementSummaryAction).toHaveBeenCalledExactlyOnceWith(vacancyId);
});
it("S6: a failed read leaves the link bar with today's unnamed copy", async () => {
  vi.mocked(loadReplacementSummaryAction).mockResolvedValue({ ok: false });
  await mount(hireBoard(life({ active_replacement_id: other })));
  await waitFor(() => expect(loadReplacementSummaryAction).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/reemplazo en curso/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Ver reemplazo" })).toHaveAttribute("href", `/empresa/vacantes/${other}/pipeline`);
});
it("a board with nothing to resolve (no departed card, no link) makes no replacement read", async () => {
  await mount(hireBoard());
  expect(loadReplacementSummaryAction).not.toHaveBeenCalled();
});
it("a move out of Placement adopts the lifecycle it returns, like a discard", async () => {
  const closedActive = life({ process: "active", process_finished_at: null, allowed_actions: [] });
  const returned = life({ process: "active", process_finished_at: null, allowed_actions: [], version: "3", can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1 });
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: moveResponse(returned) });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: returned });
  await mount(hireBoard(closedActive), vi.fn());
  expect(screen.queryByRole("button", { name: "Acciones de la vacante" })).not.toBeInTheDocument();
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Revisión" }));
  const dialog = await screen.findByRole("alertdialog", { name: "¿Mover a Ana Pérez a Revisión?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "El candidato se fue" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(moveParticipationAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: { to_stage_id: "screen", placement_exit_reason: "candidate_left" } })));
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de la vacante" }));
  expect(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" })).toBeVisible();
});
it("a move that returns no lifecycle (old backend, or not leaving Placement) keeps the current one", async () => {
  const closedActive = life({ process: "active", process_finished_at: null, allowed_actions: [] });
  const plain = { ...moveResponse(life()), lifecycle: undefined };
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: plain as Move });
  await mount(hireBoard(closedActive), vi.fn());
  fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Revisión" }));
  const dialog = await screen.findByRole("alertdialog", { name: "¿Mover a Ana Pérez a Revisión?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "El candidato se fue" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(moveParticipationAction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
  expect(screen.queryByRole("button", { name: "Acciones de la vacante" })).not.toBeInTheDocument();
});
