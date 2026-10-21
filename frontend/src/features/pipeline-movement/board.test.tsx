import "./board-filter-popover-test-double";
import type { ReactNode, ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { loadBoardAction, loadHistoryAction, loadParticipationAction, moveParticipationAction, discardParticipationAction, recoverParticipationAction, setParticipationSubstateAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { Board, FailureReason, Move, Result } from "./model";
import { checkDuplicatesAction } from "@/features/manual-intake/actions";
import { submitManualCandidate } from "@/features/manual-intake/upload";
vi.mock("@/features/manual-intake/actions", () => ({ checkDuplicatesAction: vi.fn() }));
vi.mock("@/features/manual-intake/upload", () => ({ submitManualCandidate: vi.fn() }));
// Only the combobox portal boundary is irrelevant to this board integration test.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComboboxInput: ({ id }: { id: string }) => <input id={id} />,
  ComboboxContent: () => null, ComboboxEmpty: () => null, ComboboxList: () => null, ComboboxItem: () => null,
}));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
import { getLifecycleAction, transitionLifecycleAction } from "@/features/vacancy-lifecycle/actions";
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn(), setParticipationSubstateAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Only the portal boundary is replaced: test product menu composition and actions,
// not Base UI positioning (the real menu/keyboard boundary needs browser review).
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  const Radio = React.createContext({ value: "", change: (value: string) => { void value; } });
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} onClick={() => { if (!open) onOpenChange?.(true); setOpen(true); }}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: React.ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuCheckboxItem: ({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: (value: boolean) => void; children: ReactNode }) => <button role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>{children}</button>,
    DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuSubTrigger: ({ children, disabled }: ComponentProps<"button">) => <button disabled={disabled}>{children}</button>,
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioGroup: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <Radio.Provider value={{ value, change: onValueChange }}><div role="group" aria-label="Subestado">{children}</div></Radio.Provider>,
    DropdownMenuRadioItem: ({ value, children, disabled }: { value: string; children: ReactNode; disabled: boolean }) => { const radio = React.useContext(Radio); return <button role="menuitemradio" aria-checked={value === radio.value} disabled={disabled} onClick={() => radio.change(value)}>{children}</button>; },
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, onClick, disabled }: ComponentProps<"button">) => <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
// Installed Select portal focus restoration loops in jsdom (same boundary as
// delivery-config). Preserve the product's groups, labels and controlled values.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { disabled?: boolean; value: string | null; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: null, items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children, disabled }: Value & { onValueChange: Value["change"]; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange, disabled }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button role="combobox" disabled={React.useContext(Context).disabled} aria-expanded="true" aria-controls="discard-options" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox" id="discard-options">{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    SelectLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
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
  vi.mocked(moveParticipationAction).mockImplementation(async input => ({ ok: true, data: { delivery: boardFixture().delivery, ...boardFixture().participations[0], stage_id: (input.body as { to_stage_id: string }).to_stage_id, version: "5", etag: '"next-tag"', coverage: boardFixture().coverage } }));
});
afterEach(cleanup);
async function mount(board?: Board) {
  if (board) vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board });
  const view = render(<MovementBoard vacancyId={vacancyId} />);
  await screen.findByRole("heading", { name: "Entrada" });
  return view;
}
const finishedLifecycle = { close_reason: null, close_reason_note: null, publication: "closed" as const, process: "finished" as const, version: "2", published_at: null, paused_at: null, closed_at: "2026-10-19T12:00:00Z", process_finished_at: "2026-10-20T12:00:00Z", allowed_actions: ["reopen" as const] };
const readOnlyNotice = "El proceso de esta vacante finalizó. El tablero está en solo lectura; reábrela para volver a editarlo.";
it.each([
  ["published", "active", "Publicada", "Publicada el"],
  ["paused", "active", "Pausada", "Pausada el"],
  ["closed", "active", "Cerrada · proceso en curso", "Cerrada el"],
  ["closed", "finished", "Cerrada · proceso finalizado", "Proceso finalizado el"],
] as const)("renders the lifecycle state and transition date for %s/%s", async (publication, process, label, prefix) => {
  const board = boardFixture();
  board.lifecycle = { ...finishedLifecycle, publication, process, published_at: "2026-10-20T12:00:00Z", paused_at: "2026-10-20T12:00:00Z", closed_at: "2026-10-20T12:00:00Z", allowed_actions: [] };
  await mount(board);
  // The shell owns the sole lifecycle badge; the board only owns the date.
  expect(screen.queryByText(label, { selector: '[data-slot="badge"]' })).toBeNull();
  expect(screen.getByText(new RegExp(prefix))).toHaveTextContent(/20 oct 2026/);
  expect(screen.queryByRole("button", { name: "Acciones de la vacante" })).not.toBeInTheDocument();
  if (process === "active") expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeEnabled();
});
it("offers manual intake only for a published, active process", async () => {
  await mount();
  expect(screen.getByRole("button", { name: "Agregar candidato" })).toBeEnabled();
});
it.each(["draft", "finished"])("hides manual intake for %s", async condition => {
  const board = boardFixture();
  if (condition === "finished") board.lifecycle.process = "finished";
  else board.lifecycle.publication = null;
  await mount(board);
  expect(screen.queryByRole("button", { name: "Agregar candidato" })).not.toBeInTheDocument();
});
it("labels manual cards without claiming an application", async () => {
  const board = boardFixture();
  Object.assign(board.participations[0], { source: "manual", added_by: { id: "recruiter", name: "Luis" } });
  await mount(board);
  expect(screen.getByText("Ingreso manual")).toHaveAttribute("data-slot", "badge");
  expect(screen.queryByText(/Postuló/)).not.toBeInTheDocument();
});
it("adds a manual card in place, focuses it and shows its origin in the sheet", async () => {
  const board = boardFixture();
  const added = { ...board.participations[0], id: "added", source: "manual" as const, added_by: { id: "recruiter", name: "Luis López" }, candidate: { id: "new-person", kind: "manual" as const, full_name: "María Nueva" }, coverage: board.coverage, delivery: board.delivery };
  vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [{ kind: "manual", id: "new-person", full_name: "María Nueva", email_masked: "m***@test.com", phone_masked: null, last_vacancy: "Ventas", last_added_at: added.applied_at, in_this_process: false }] } });
  vi.mocked(submitManualCandidate).mockResolvedValue({ ok: true, data: added });
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Correo electrónico" }), { target: { value: "maria@test.com" } }); fireEvent.blur(screen.getByRole("textbox", { name: "Correo electrónico" }));
  fireEvent.click(await screen.findByRole("button", { name: "Usar el existente" }));
  fireEvent.change(screen.getByLabelText(/^CV/), { target: { files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Agregar" })); });
  const card = await screen.findByRole("button", { name: "Ver detalle de María Nueva" });
  await waitFor(() => expect(card.closest('[data-slot="card"]')).toHaveFocus());
  expect(screen.getByText("Ingreso manual")).toBeVisible(); expect(loadBoardAction).toHaveBeenCalledOnce();
  expect(screen.getByRole("region", { name: "Entrada: 2 candidatos" })).toContainElement(card);
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...added, screening: [], comment: null, candidate_message: null } });
  fireEvent.click(card); const sheet = await screen.findByRole("dialog", { name: "María Nueva" });
  await waitFor(() => expect(within(sheet).queryByText("Cargando detalle e historial")).not.toBeInTheDocument());
  expect(within(sheet).getByText(/Agregado por Luis López el/)).toBeVisible();
  expect(within(sheet).queryByText(/postul/i)).not.toBeInTheDocument();
});
it("E2 uses singular candidate counts", async () => {
 await mount();
 expect(screen.getByText(/candidato en el pipeline/)).toHaveTextContent("1 candidato en el pipeline");
 expect(screen.getByRole("region", { name: "Entrada: 1 candidato" })).toBeVisible();
});
it("E4 hides finished card and column handles", async () => {
 const board = boardFixture(); board.lifecycle = finishedLifecycle;
 await mount(board);
 expect(screen.queryByRole("button", { name: /^Arrastrar / })).not.toBeInTheDocument();
 expect(screen.queryByRole("button", { name: /^Reordenar / })).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" })).toBeEnabled();
});
it("E5 hides pending delivery deadline on a finished board", async () => {
 const board = boardFixture(); board.lifecycle = finishedLifecycle;
 await mount(board);
 expect(screen.queryByText("Plazo de entrega no disponible")).not.toBeInTheDocument();
});
it("sends the authoritative board lifecycle to the header owner", async () => {
  const onLifecycleChange = vi.fn();
  render(<MovementBoard vacancyId={vacancyId} onLifecycleChange={onLifecycleChange} />);
  await waitFor(() => expect(onLifecycleChange).toHaveBeenCalledWith(boardFixture().lifecycle));
});
it("does not suggest reopening without permission", async () => {
  const board = boardFixture(); board.lifecycle = { ...finishedLifecycle, allowed_actions: [] };
  await mount(board);
  expect(screen.getByText("El proceso de esta vacante finalizó. El tablero está en solo lectura.")).toBeVisible();
  expect(screen.queryByText(/reábrela/)).toBeNull();
});
it("keeps finished boards readable but disables card, sheet and drag writes", async () => {
  const board = boardFixture(); board.lifecycle = finishedLifecycle;
  await mount(board);
  expect(screen.getByText(readOnlyNotice)).toBeVisible();
  expect(screen.getByText(readOnlyNotice).closest('[role="status"]')).toHaveTextContent(readOnlyNotice);
  expect(screen.queryByRole("button", { name: "Arrastrar Ana Pérez" })).not.toBeInTheDocument();
  for (const target of within(menu()).getAllByRole("menuitem").filter(item => item.textContent !== "Ver ficha")) expect(target).toBeDisabled();
  act(() => drag.props.onDragEnd({ active: { id: "person" }, over: { id: "screen" } }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(within(sheet).getByRole("button", { name: "Mover a…" })).toBeDisabled();
  expect(within(sheet).getByRole("button", { name: "Descartar" })).toBeDisabled();
  expect(await within(sheet).findByRole("link", { name: "Descargar CV" })).toBeVisible();
  expect(within(sheet).getByRole("tab", { name: /Historial/ })).toBeEnabled();
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("adopts a process_finished move conflict without reload or retry", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: false, reason: "process_finished", lifecycle: finishedLifecycle, reference: { status: 409 } });
  await mount(); move();
  expect(await screen.findByText(readOnlyNotice)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Arrastrar Ana Pérez" })).not.toBeInTheDocument();
  expect(loadBoardAction).toHaveBeenCalledTimes(1); expect(moveParticipationAction).toHaveBeenCalledTimes(1);
});
it("wires lifecycle actions and adopts their response without reloading candidates", async () => {
  const board = boardFixture(); board.lifecycle.allowed_actions = ["pause"];
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, data: board.lifecycle, etag: "lifecycle-tag" });
  vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: true, data: { ...board.lifecycle, publication: "paused", paused_at: "2026-10-20T12:00:00Z", version: "2", allowed_actions: ["resume"] }, etag: "next" });
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Acciones de la vacante" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Pausar" }));
  fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
  expect(await screen.findByText(/Pausada el/)).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  expect(transitionLifecycleAction).toHaveBeenCalledWith(expect.objectContaining({ draftId: vacancyId, action: "pause", ifMatch: "lifecycle-tag" }));
});
it("reopening restores editing in place and absent publication time stays absent", async () => {
  const board = boardFixture(); board.lifecycle = finishedLifecycle;
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, data: finishedLifecycle, etag: "finished-tag" });
  vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: true, data: { ...boardFixture().lifecycle, version: "3", allowed_actions: ["pause"] }, etag: "reopened-tag" });
  await mount(board);
  fireEvent.click(screen.getByRole("button", { name: "Acciones de la vacante" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reabrir" }));
  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeEnabled());
  expect(screen.queryByText(readOnlyNotice)).not.toBeInTheDocument();
  expect(screen.queryByText(/Publicada el/)).not.toBeInTheDocument();
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it.each(["discard", "recover", "substate"] as const)("adopts process_finished from %s and closes the pending dialog", async operation => {
  const failure = { ok: false as const, reason: "process_finished" as const, lifecycle: finishedLifecycle, reference: { status: 409 } };
  vi.mocked(discardParticipationAction).mockResolvedValue(failure);
  vi.mocked(recoverParticipationAction).mockResolvedValue(failure);
  vi.mocked(setParticipationSubstateAction).mockResolvedValue(failure);
  await mount(operation === "recover" ? discardedBoard() : operation === "substate" ? activeSubstateBoard() : boardFixture());
  if (operation === "substate") {
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar subestado" }));
  } else {
    fireEvent.click(within(menu()).getByRole("menuitem", { name: operation === "discard" ? "Descartar" : "Recuperar" }));
    if (operation === "discard") fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
    fireEvent.click(screen.getByRole("button", { name: operation === "discard" ? "Descartar candidato" : "Recuperar" }));
  }
  expect(await screen.findByText(readOnlyNotice)).toBeVisible();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  expect(operation === "discard" ? discardParticipationAction : operation === "recover" ? recoverParticipationAction : setParticipationSubstateAction).toHaveBeenCalledTimes(1);
});
it.each(["substate", "recover"] as const)("finished %s controls remain disabled in cards and sheet", async operation => {
  const board = operation === "recover" ? discardedBoard() : activeSubstateBoard();
  board.lifecycle = { ...finishedLifecycle, allowed_actions: [] };
  await mount(board);
  expect(screen.queryByText(/Reabrir.*editar/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filtros" })).toBeEnabled();
  const actions = menu();
  if (operation === "substate") for (const option of within(actions).getAllByRole("menuitemradio")) expect(option).toBeDisabled();
  else expect(within(actions).getByRole("menuitem", { name: "Recuperar" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(operation === "recover" ? within(sheet).getByRole("button", { name: "Recuperar" }) : within(sheet).getByRole("combobox", { name: "Subestado" })).toBeDisabled();
});
function menu() { fireEvent.click(screen.getByRole("button", { name: "Acciones de Ana Pérez" })); return screen.getByRole("menu"); }
function move(label = "Revisión", confirm = true) {
  fireEvent.click(within(menu()).getByRole("menuitem", { name: label }));
  if (confirm && !screen.getByRole("alertdialog").textContent?.includes("disminuyen en una")) fireEvent.click(screen.getByRole("button", { name: "Mover" }));
}

it.each(["menu", "sheet", "pointer", "keyboard"])("%s move waits for confirmation, cancellation writes nothing, and double confirm writes once", async source => {
  vi.mocked(moveParticipationAction).mockReturnValue(new Promise(() => {}));
  await mount();
  if (source === "sheet") { fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" })); await screen.findByRole("dialog", { name: "Ana Pérez" }); }
  const request = () => {
    if (source === "sheet") {
      const sheet = screen.getByRole("dialog", { name: "Ana Pérez" });
      fireEvent.click(within(sheet).getByRole("button", { name: "Mover a…" }));
      fireEvent.click(within(sheet).getByRole("menuitem", { name: "Revisión" }));
    }
    else if (source === "menu") move("Revisión", false);
    else {
      act(() => drag.props.onDragStart({ active: { id: "person" }, activatorEvent: { type: source === "keyboard" ? "keydown" : "pointerdown" } }));
      act(() => drag.props.onDragEnd({ active: { id: "person" }, over: { id: "screen" } }));
    }
  };
  request();
  const dialog = screen.getByRole("alertdialog", { name: "¿Mover a Ana Pérez a Revisión?" });
  expect(dialog).toHaveAccessibleDescription("Pasa de Entrada a Revisión. El cambio queda en su historial.");
  expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  expect(moveParticipationAction).not.toHaveBeenCalled();
  expect(document.getElementById("candidate-move-person")?.closest('[data-pf-published-column]')).toHaveAttribute("aria-label", "Entrada: 1 candidato");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(moveParticipationAction).not.toHaveBeenCalled();
  request();
  const confirm = screen.getByRole("button", { name: "Mover" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
});

it("menu lists next forward and earlier targets plus discard, never current, skipped or exit as a move", async () => {
  const board = boardFixture(); board.participations[0].stage_id = "interview";
  await mount(board);
  expect(within(menu()).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Entrada", "Revisión", "Contratación", "Ver ficha", "Descartar"]);
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
  const dialog = await screen.findByRole("alertdialog", { name: "¿Mover a Ana Pérez a Revisión?" });
  expect(dialog).toHaveTextContent("Las plazas cubiertas disminuyen en una"); expect(dialog).toHaveTextContent("conserva el historial");
  expect(moveParticipationAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Ana Pérez salió de Contratación" })));
  expect(screen.queryByText("Ana Pérez salió de Contratación")).not.toBeInTheDocument();
  expect(moveParticipationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: '"opaque-item-tag"', body: { to_stage_id: "screen", confirm_placement_exit: true } });
});
it("also requests explicit Placement confirmation after the server's 409", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason: "placement_exit_confirmation_required", reference: { status: 409 } });
  await mount(); move();
  const dialog = await screen.findByRole("alertdialog");
  await within(dialog).findByText(/Las plazas cubiertas disminuyen en una/);
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Ana Pérez pasó a Revisión" })));
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
it("sheet movement uses allowed targets and nests the Placement confirmation without losing the sheet", async () => {
  const board = boardFixture(); board.participations[0].stage_id = "hire";
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Mover a…" }));
  fireEvent.click(within(sheet).getByRole("menuitem", { name: "Revisión" }));
  const confirmation = await screen.findByRole("alertdialog", { name: "¿Mover a Ana Pérez a Revisión?" });
  expect(confirmation).toHaveAttribute("data-nested");
  expect(moveParticipationAction).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("dialog", { name: "Ana Pérez" })).toBeVisible();
});
it("sheet displays screening, stage names, timeline badges/actors/dates and a private CV download link", async () => {
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(await within(sheet).findByRole("link", { name: "Descargar CV" })).toHaveAttribute("href", `/api/company/vacancies/${vacancyId}/participations/person/cv`);
  expect(within(sheet).getByRole("link", { name: "Descargar CV" })).toHaveAttribute("download");
  await act(async () => { fireEvent.click(within(sheet).getByRole("tab", { name: "Respuestas 2" })); });
  for (const copy of ["¿Disponibilidad?", "Inmediata", "¿Por qué te interesa?", "Quiero aportar al equipo."]) expect(within(sheet).getByText(copy)).toBeVisible();
  await act(async () => { fireEvent.click(within(sheet).getByRole("tab", { name: "Historial 3" })); });
  for (const copy of ["Postulación recibida", "Entrevista → Contratación", "Contratación → Revisión", "Contratación", "Salida de Placement", "Ana Pérez · Candidato", "Luis López · Reclutador"]) expect(within(sheet).getAllByText(copy).length).toBeGreaterThan(0);
  expect(sheet.querySelectorAll("time").length).toBe(4);
  expect(loadParticipationAction).toHaveBeenCalledExactlyOnceWith(vacancyId, "person");
  expect(loadHistoryAction).toHaveBeenCalledExactlyOnceWith(vacancyId, "person");
});
it.each([2, null])("coverage copy with required %s; milestone remains visible after departures", async required => {
  const board = boardFixture(); board.coverage = { covered: 1, required, full_coverage_reached_at: "2026-10-16T12:00:00Z" };
  await mount(board);
  expect(screen.getByLabelText("Cobertura")).toHaveTextContent(required === null ? "1 plaza cubierta" : "1 de 2 plazas cubiertas");
  expect(screen.getByText(/Se completó el/)).toBeVisible();
  expect(screen.queryByText("Cobertura completa")).not.toBeInTheDocument();
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
  expect(screen.getAllByText("Sin candidatos en esta etapa")).toHaveLength(5);
  expect(screen.getByText(/candidatos en el pipeline/)).toHaveTextContent("0 candidatos en el pipeline");
  expect(screen.getByLabelText("Se llega descartando, no moviendo")).toBeVisible(); expect(notifyActionResult).not.toHaveBeenCalled();
});
it("200 applies new stage, counts, etag and server coverage; double submission is locked", async () => {
  let resolve!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  await mount(); move();
  expect(document.getElementById("candidate-move-person")).toBeDisabled();
  expect(document.getElementById("candidate-drag-person")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Moviendo…" }));
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, data: { delivery: boardFixture().delivery, ...boardFixture().participations[0], stage_id: "screen", version: "5", etag: '"new-opaque"', coverage: { covered: 1, required: 2, full_coverage_reached_at: null } } }));
  expect(screen.getByRole("region", { name: "Revisión: 1 candidato" })).toHaveTextContent("Ana Pérez");
  expect(screen.getByRole("region", { name: "Entrada: 0 candidatos" })).not.toHaveTextContent("Ana Pérez");
  expect(screen.getByLabelText("Cobertura")).toHaveTextContent("1 de 2 plazas cubiertas");
  move("Entrada"); await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Ana Pérez pasó a Entrada" })));
  expect(moveParticipationAction).toHaveBeenLastCalledWith(expect.objectContaining({ etag: '"new-opaque"' }));
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it.each(["stage_skip_not_allowed", "validation_error", "vacancy_not_published"] as FailureReason[])("%s leaves board unchanged with persistent feedback", async reason => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason, reference: { status: 409 } });
  await mount(); move();
  await screen.findByRole("status");
  expect(screen.getByRole("region", { name: "Entrada: 1 candidato" })).toHaveTextContent("Ana Pérez");
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});
it("failed reconciliation locks stale writes and offers a read-only retry", async () => {
  vi.mocked(moveParticipationAction).mockResolvedValueOnce({ ok: false, reason: "uncertain", reference: {} });
  await mount(); vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }); move();
  await screen.findByRole("button", { name: "Reintentar" });
  expect(screen.getByRole("button", { name: "Acciones de Ana Pérez" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Tablero actualizado");
  expect(moveParticipationAction).toHaveBeenCalledTimes(1); expect(loadBoardAction).toHaveBeenCalledTimes(3);
});
it("restores keyboard focus to the moved card's menu", async () => {
  await mount();
  screen.getByRole("button", { name: "Acciones de Ana Pérez" }).focus();
  move();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Ana Pérez pasó a Revisión" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "Acciones de Ana Pérez" })).toHaveFocus());
});
it.each(["success", "uncertain"])("pending confirmation prevents overlapping UI moves and preserves %s reconciliation", async outcome => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "second", candidate: { id: "second-candidate", full_name: "Eva Ruiz", kind: "organic" } });
  let resolve!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  await mount(board); move();
  expect(document.getElementById("candidate-move-second")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Moviendo…" })).toBeDisabled();
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  await act(async () => resolve(outcome === "success" ? { ok: true, data: { delivery: board.delivery, ...board.participations[0], stage_id: "screen", coverage: board.coverage } } : { ok: false, reason: "uncertain", reference: {} }));
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  expect(loadBoardAction).toHaveBeenCalledTimes(outcome === "success" ? 1 : 2);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Acciones de Eva Ruiz" })).toBeEnabled();
});
it("sheet has independent loading/error/retry without reloading board or moving", async () => {
  vi.mocked(loadHistoryAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  fireEvent.click(await within(sheet).findByRole("button", { name: "Reintentar" }));
  fireEvent.click(await within(sheet).findByRole("tab", { name: "Historial 3" }));
  expect(await within(sheet).findByText("Entrevista → Contratación")).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(1); expect(loadHistoryAction).toHaveBeenCalledTimes(2);
  expect(moveParticipationAction).not.toHaveBeenCalled();
});

function activeSubstateBoard(): Board {
  const board = boardFixture(); board.stages[2].kind = "in_process";
  board.substates = [{ id: "tech", name: "Entrevista técnica" }, { id: "offer", name: "Oferta" }];
  board.participations[0] = { ...board.participations[0], stage_id: "interview", substate_id: "tech" }; board.stages[0].count = 0; board.stages[2].count = 1;
  return board;
}
it("card radio options follow catalog order, share the write path and update the badge", async () => {
  const board = activeSubstateBoard();
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: true, data: { delivery: board.delivery, ...board.participations[0], substate_id: null, etag: '"cleared"', coverage: board.coverage } });
  await mount(board);
  const actions = menu();
  expect(within(actions).getAllByRole("menuitemradio").map(option => option.textContent)).toEqual(["Entrevista técnica", "Oferta", "Sin subestado"]);
  expect(within(actions).getByRole("menuitemradio", { name: "Entrevista técnica" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(within(actions).getByRole("menuitemradio", { name: "Sin subestado" }));
  fireEvent.click(screen.getByRole("button", { name: "Cambiar subestado" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Ana Pérez quedó sin subestado", description: "Antes: Entrevista técnica." })));
  expect(setParticipationSubstateAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: board.participations[0].etag, body: { substate_id: null } });
  expect(document.querySelector('.pf-candidate-card [data-slot="badge"]')).toBeNull();
});
it("toolbar filter wires OR selections, excludes other stages and clears without a read", async () => {
  const board = activeSubstateBoard(); board.participations.push({ ...board.participations[0], id: "null", substate_id: null, candidate: { id: "second", full_name: "Eva Ruiz", kind: "organic" } }, { ...board.participations[0], id: "outside", stage_id: "new", substate_id: null, candidate: { id: "third", full_name: "Sol Díaz", kind: "organic" } });
  vi.stubGlobal("PointerEvent", MouseEvent);
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.click(screen.getByRole("button", { name: "Subestado" }));
  const group = screen.getByRole("dialog", { name: "Filtrar candidatos" });
  const options = within(group).getAllByRole("checkbox"); expect(options).toHaveLength(3);
  fireEvent.click(within(group).getByRole("checkbox", { name: "Entrevista técnica 1" }));
  fireEvent.click(within(group).getByRole("checkbox", { name: "Sin subestado 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver 2 candidatos" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filtrar candidatos" })).not.toBeInTheDocument());
  expect(screen.getByRole("region", { name: "Entrevista: 2 de 2 candidatos" })).toHaveTextContent("Ana Pérez");
  expect(screen.queryByRole("button", { name: "Ver detalle de Sol Díaz" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filtros 2" })).toBeVisible();
  expect(screen.getByText(/Vista filtrada · Mostrando 2 de 3 candidatos/)).toHaveAttribute("aria-live", "polite");
  fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
  vi.unstubAllGlobals();
  expect(screen.getByRole("button", { name: "Ver detalle de Sol Díaz" })).toBeVisible(); expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it("sheet selector uses confirmed board value and snapshot history survives catalog renames", async () => {
  const board = activeSubstateBoard();
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: { items: [{ kind: "substate", from_substate_id: null, from_substate_name: null, to_substate_id: "tech", to_substate_name: "Nombre anterior", actor: { kind: "recruiter", id: "actor", full_name: "Luis López" }, at: "2026-10-18T12:00:00Z" }] } });
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: true, data: { delivery: board.delivery, ...board.participations[0], substate_id: "offer", etag: '"offer"', coverage: board.coverage } });
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(within(sheet).getByRole("combobox", { name: "Subestado" })).toHaveTextContent("Entrevista técnica");
  fireEvent.click(within(sheet).getByRole("option", { name: "Oferta" }));
  fireEvent.click(screen.getByRole("button", { name: "Cambiar subestado" }));
  await waitFor(() => expect(within(sheet).getByRole("combobox", { name: "Subestado" })).toHaveTextContent("Oferta"));
  fireEvent.click(within(sheet).getByRole("tab", { name: "Historial 1" }));
  expect(await within(sheet).findByText("Subestado: Sin subestado → Nombre anterior")).toBeVisible();
});
async function openDiscard(board?: Board) {
  await mount(board); fireEvent.click(within(menu()).getByRole("menuitem", { name: "Descartar" }));
  return screen.findByRole("alertdialog", { name: "¿Descartar a Ana Pérez?" });
}
it.each(["menu", "sheet"])("%s substate requires confirmation and ignores the current value", async source => {
  vi.mocked(setParticipationSubstateAction).mockReturnValue(new Promise(() => {}));
  await mount(activeSubstateBoard());
  if (source === "sheet") { fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" })); await screen.findByRole("dialog", { name: "Ana Pérez" }); }
  const choose = (name: string) => fireEvent.click(source === "menu" ? within(menu()).getByRole("menuitemradio", { name }) : screen.getByRole("option", { name }));
  choose("Entrevista técnica"); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  choose("Oferta");
  const dialog = screen.getByRole("alertdialog", { name: "¿Cambiar el subestado de Ana Pérez?" });
  expect(dialog).toHaveAccessibleDescription("Pasa de Entrevista técnica a Oferta.");
  expect(setParticipationSubstateAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(setParticipationSubstateAction).not.toHaveBeenCalled();
  await waitFor(() => expect(document.getElementById(source === "sheet" ? "candidate-substate-person" : "candidate-move-person")).toHaveFocus());
  choose("Oferta"); const confirm = screen.getByRole("button", { name: "Cambiar subestado" }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(setParticipationSubstateAction).toHaveBeenCalledTimes(1);
});

it.each(["discard", "recover"])("%s uses an action-named alert with cancel and destructive tone when needed", async kind => {
  await mount(kind === "discard" ? boardFixture() : discardedBoard());
  fireEvent.click(within(menu()).getByRole("menuitem", { name: kind === "discard" ? "Descartar" : "Recuperar" }));
  const dialog = screen.getByRole("alertdialog", { name: kind === "discard" ? "¿Descartar a Ana Pérez?" : "¿Recuperar a Ana Pérez?" });
  expect(within(dialog).getByRole("button", { name: kind === "discard" ? "Descartar candidato" : "Recuperar" }).className).toContain(kind === "discard" ? "destructive" : "bg-primary");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(discardParticipationAction).not.toHaveBeenCalled(); expect(recoverParticipationAction).not.toHaveBeenCalled();
});

function discardedBoard(previous = "new"): Board {
  const board = boardFixture();
  board.participations[0] = { ...board.participations[0], stage_id: "exit", discard: { reason: { group: "recruiter", key: "profile_mismatch" }, previous_stage_id: previous, recovery_stage_id: previous, discarded_at: "2026-10-18T12:00:00Z" } };
  board.stages[0].count = 0; board.exit.count = 1; return board;
}
it("discard form requires a grouped reason and explanation for other, with code-point counters", async () => {
  const dialog = await openDiscard();
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  expect(await within(dialog).findByText("Elige un motivo.")).toBeVisible();
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Motivo" }));
  expect(await screen.findByText("Decisión de la empresa")).toBeVisible();
  expect(screen.getByText("Decisión del candidato")).toBeVisible();
  fireEvent.click(screen.getAllByRole("option", { name: "Otro" })[0]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  expect(await within(dialog).findByText("Explica el motivo en el comentario.")).toBeVisible();
  expect(discardParticipationAction).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Comentario interno/ }), { target: { value: "😀" } });
  expect(within(dialog).getByText("1 / 1000")).toBeVisible();
  expect(dialog).toHaveTextContent("Finalizada"); expect(dialog).toHaveTextContent("nunca el motivo");
});
it("discard from Placement explicitly confirms departure and reduces coverage without erasing history", async () => {
  const board = boardFixture(); board.participations[0].stage_id = "hire";
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: { delivery: board.delivery, ...discardedBoard("hire").participations[0], coverage: board.coverage } });
  const dialog = await openDiscard(board);
  expect(dialog).toHaveTextContent("Las plazas cubiertas disminuyen en una");
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Motivo" }));
  fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Descartaste a Ana Pérez" })));
  expect(screen.queryByText("Descartaste a Ana Pérez")).not.toBeInTheDocument();
  expect(discardParticipationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: '"opaque-item-tag"', body: { reason: { group: "recruiter", key: "requirements_not_met" }, confirm_placement_exit: true } });
});
it.each(["new", "hire"])("discarded column shows reason and recover confirms the current name of %s", async previous => {
  const board = discardedBoard(previous);
  vi.mocked(recoverParticipationAction).mockResolvedValue({ ok: true, data: { delivery: board.delivery, ...boardFixture().participations[0], stage_id: previous, coverage: board.coverage } });
  await mount(board);
  expect(screen.getByRole("region", { name: "Descartados: 1 candidato" })).toHaveTextContent("Perfil no adecuado");
  const actions = menu();
  expect(within(actions).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Recuperar", "Ver ficha"]);
  fireEvent.click(within(actions).getByRole("menuitem", { name: "Recuperar" }));
  const dialog = await screen.findByRole("alertdialog", { name: "¿Recuperar a Ana Pérez?" });
  expect(dialog).toHaveTextContent(previous === "hire" ? "Contratación" : "Entrada");
  if (previous === "hire") expect(dialog).toHaveTextContent("ocupar una plaza");
  expect(recoverParticipationAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Recuperaste a Ana Pérez" })));
  expect(recoverParticipationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: "person", etag: '"opaque-item-tag"', body: previous === "hire" ? { confirm_placement_reentry: true } : {} });
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it.each(["already_discarded", "not_discarded", "version_conflict", "not_found", "uncertain", "unrecognized_response"] as const)("discard %s reloads once and never retries", async reason => {
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: false, reason, reference: {} });
  const dialog = await openDiscard();
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Motivo" }));
  fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  await screen.findByText(/Actualizamos el tablero|Otro usuario/);
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(discardParticipationAction).toHaveBeenCalledTimes(1);
});
it("validation_error keeps the dialog and user input, without a reload", async () => {
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 } });
  const dialog = await openDiscard();
  fireEvent.click(within(dialog).getByRole("combobox", { name: "Motivo" }));
  fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Comentario interno/ }), { target: { value: "Mi comentario" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Mensaje para el candidato/ }), { target: { value: "Gracias" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  expect(await within(dialog).findByText("No se guardó. Revisa los datos e intenta de nuevo.")).toBeVisible();
  expect(within(dialog).getByRole("textbox", { name: /Comentario interno/ })).toHaveValue("Mi comentario");
  expect(within(dialog).getByRole("textbox", { name: /Mensaje para el candidato/ })).toHaveValue("Gracias");
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it.each(["discard", "recover"] as const)("server 409 %s confirmation requires a fresh explicit confirmation", async operation => {
  if (operation === "discard") {
    vi.mocked(discardParticipationAction).mockResolvedValue({ ok: false, reason: "placement_exit_confirmation_required", reference: { status: 409 } });
    const dialog = await openDiscard();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Motivo" }));
    fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
    expect(await within(dialog).findByText(/Las plazas cubiertas disminuyen en una/)).toBeVisible();
    expect(discardParticipationAction).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" })));
    expect(discardParticipationAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ confirm_placement_exit: true }) }));
  } else {
    vi.mocked(recoverParticipationAction).mockResolvedValue({ ok: false, reason: "placement_reentry_confirmation_required", reference: { status: 409 } });
    await mount(discardedBoard()); fireEvent.click(within(menu()).getByRole("menuitem", { name: "Recuperar" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Recuperar a Ana Pérez?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" }));
    expect(await within(dialog).findByText(/ocupar una plaza/)).toBeVisible();
    expect(recoverParticipationAction).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" })));
    expect(recoverParticipationAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: { confirm_placement_reentry: true } }));
  }
});
it("sheet offers discard, shows current discard details and renders discard/recovery history", async () => {
  const board = discardedBoard(); const base = { ...historyFixture().items[1], from_stage_id: "hire" };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), ...board.participations[0], comment: "Solo interno", candidate_message: "Gracias por participar" } });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: { items: [
    { ...base, kind: "discard", hire: false, departure: true, reason: { group: "candidate", key: "other" }, comment: "Cambió de planes", candidate_message: "Mensaje histórico" },
    { ...base, kind: "recovery", hire: true, departure: false },
  ] } });
  await mount(board); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(await within(sheet).findByText("Solo interno")).toBeVisible();
  expect(within(sheet).getByText("Gracias por participar")).toBeVisible();
  fireEvent.click(within(sheet).getByRole("tab", { name: "Historial 2" }));
  for (const text of ["Cambió de planes", "Mensaje histórico", "Recuperación", "Contratación", "Salida de Placement"]) expect(within(sheet).getByText(text)).toBeVisible();
  fireEvent.click(within(sheet).getByRole("button", { name: "Recuperar" }));
  expect(await screen.findByRole("alertdialog", { name: "¿Recuperar a Ana Pérez?" })).toBeVisible();
});
it.each(["not_discarded", "version_conflict", "not_found", "uncertain", "unrecognized_response"] as const)("recovery %s reloads once, never replaying", async reason => {
  vi.mocked(recoverParticipationAction).mockResolvedValue({ ok: false, reason, reference: {} });
  await mount(discardedBoard()); fireEvent.click(within(menu()).getByRole("menuitem", { name: "Recuperar" }));
  const dialog = await screen.findByRole("alertdialog", { name: "¿Recuperar a Ana Pérez?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" }));
  await screen.findByText(/Actualizamos el tablero|Otro usuario/);
  expect(loadBoardAction).toHaveBeenCalledTimes(2); expect(recoverParticipationAction).toHaveBeenCalledTimes(1);
});
it.each(["discard", "recover"] as const)("%s shares the per-card mutex and cannot be double-submitted or cancelled while pending", async operation => {
  let resolve!: (value: Result<Move>) => void;
  const action = operation === "discard" ? discardParticipationAction : recoverParticipationAction;
  vi.mocked(action).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  let dialog;
  if (operation === "discard") {
    dialog = await openDiscard();
    fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  } else {
    await mount(discardedBoard()); fireEvent.click(within(menu()).getByRole("menuitem", { name: "Recuperar" }));
    dialog = await screen.findByRole("alertdialog", { name: "¿Recuperar a Ana Pérez?" });
  }
  const confirm = within(dialog).getByRole("button", { name: operation === "discard" ? "Descartar candidato" : "Recuperar" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(confirm).toBeDisabled(); expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, data: { delivery: boardFixture().delivery, ...(operation === "discard" ? discardedBoard().participations[0] : boardFixture().participations[0]), coverage: boardFixture().coverage } }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it("validates controls and both code-point limits in the form, then sends trimmed text without blank optional fields", async () => {
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: {} });
  const dialog = await openDiscard();
  fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  const comment = within(dialog).getByRole("textbox", { name: /Comentario interno/ });
  const message = within(dialog).getByRole("textbox", { name: /Mensaje para el candidato/ });
  const confirm = within(dialog).getByRole("button", { name: "Descartar candidato" });
  fireEvent.change(comment, { target: { value: "😀".repeat(1001) } });
  fireEvent.click(confirm); expect(within(dialog).getByText("Usa como máximo 1000 caracteres.")).toBeVisible(); expect(comment).toHaveFocus();
  fireEvent.change(comment, { target: { value: "\u0085\t" } });
  fireEvent.change(message, { target: { value: "😀".repeat(501) } });
  fireEvent.click(confirm); expect(within(dialog).getByText("Usa como máximo 500 caracteres.")).toBeVisible(); expect(message).toHaveFocus();
  fireEvent.change(message, { target: { value: "Hola\u0000" } });
  fireEvent.click(confirm); expect(within(dialog).getByText(/Quita los caracteres de control/)).toBeVisible();
  expect(discardParticipationAction).not.toHaveBeenCalled();
  fireEvent.change(message, { target: { value: "\u0085 😀\nTexto \u2003" } });
  fireEvent.click(confirm); await within(dialog).findByText("No se guardó. Revisa los datos e intenta de nuevo.");
  expect(discardParticipationAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: { reason: { group: "recruiter", key: "requirements_not_met" }, candidate_message: "😀\nTexto" } }));
});
it("sheet starts discard and refreshes current detail/history after successful disposition", async () => {
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  fireEvent.click(await within(sheet).findByRole("button", { name: "Descartar" }));
  const dialog = await screen.findByRole("alertdialog", { name: "¿Descartar a Ana Pérez?" });
  fireEvent.click(await screen.findByRole("option", { name: "No cumple requisitos" }));
  const discarded = { ...discardedBoard().participations[0], etag: '"discarded"', version: "5" };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), ...discarded, comment: "Nuevo descarte" } });
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: { delivery: boardFixture().delivery, ...discarded, coverage: boardFixture().coverage } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Descartar candidato" }));
  expect(await screen.findByText("Nuevo descarte")).toBeVisible();
  expect(loadParticipationAction).toHaveBeenCalledTimes(2); expect(loadHistoryAction).toHaveBeenCalledTimes(2);
  expect(within(screen.getByRole("dialog", { name: "Ana Pérez" })).getByRole("button", { name: "Recuperar" })).toBeEnabled();
});
