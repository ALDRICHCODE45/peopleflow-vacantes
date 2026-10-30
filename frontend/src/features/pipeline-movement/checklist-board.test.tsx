import "./board-filter-popover-test-double";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { boardFixture, detailFixture, historyFixture } from "./board-fixture";
import { loadBoardAction, loadParticipationAction, loadHistoryAction, moveParticipationAction } from "./actions";
import { loadChecklistAction, loadChecklistMarksAction } from "@/features/vacancy-checklist/actions";
// Match delivery-config's context-backed Select boundary; preserve product values/options.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { value: string; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: "", items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Value & { onValueChange: Value["change"]; children: React.ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="board-sort-options" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div role="listbox" id="board-sort-options">{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadParticipationAction: vi.fn(), loadHistoryAction: vi.fn(), moveParticipationAction: vi.fn() }));
// Only the menu portal boundary is replaced; real board confirmation and moves remain.
vi.mock("./candidate-menu", () => ({ CandidateMenu: ({ item, targets, onMove }: { item: { id: string }; targets: { id: string; name: string }[]; onMove: (id: string, target: string) => void }) => <>{targets.map(target => <button key={target.id} onClick={() => onMove(item.id, target.id)}>Mover {item.id} a {target.name}</button>)}</> }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/vacancy-checklist/actions", () => ({ loadChecklistAction: vi.fn(), loadChecklistMarksAction: vi.fn(), setChecklistMarkAction: vi.fn(), clearChecklistMarkAction: vi.fn() }));
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board, locked: true, structureLocked: true }) }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn(async () => ({ ok: false })) }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const board = boardFixture();
  const first = board.participations[0];
  board.participations = [first, { ...first, id: "second", candidate: { ...first.candidate, full_name: "Beatriz" }, profile: { ...first.profile, years_of_experience: "5" } }, { ...first, id: "third", candidate: { ...first.candidate, full_name: "Carlos" }, profile: { ...first.profile, years_of_experience: "1" } }];
  first.profile.years_of_experience = null;
  board.stages[0].count = 3;
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: { ...first, stage_id: board.stages[1].id, version: "5", etag: "next", delivery: board.delivery, coverage: board.coverage } });
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [], criteria: [{ id: "c", label: "Experiencia", kind: "min_years_experience", params: { min: "3" }, importance: "required" }] } });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [] } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("opens the checklist tab independently of detail loading", async () => {
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByText("1/1 obligatorios");
  fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Checklist" }));
  expect(await screen.findByRole("region", { name: "Checklist del candidato" })).toBeVisible();
  expect(screen.queryByText(/perfil/)).not.toBeInTheDocument();
});
it("shows the reminder in the actual confirmation and moves without marks", async () => {
  const board = boardFixture();
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [board.stages[1].id], criteria: [{ id: "c", label: "Entrevista", kind: "manual", params: {}, importance: "required" }] } });
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findAllByLabelText(/Ajuste al checklist/);
  fireEvent.click(screen.getByRole("button", { name: `Mover ${board.participations[0].id} a ${board.stages[1].name}` }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByRole("region", { name: "Antes de mover" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Mover" })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(moveParticipationAction).toHaveBeenCalledOnce());
});
it("reminds only when moving forward, never when sending a candidate back", async () => {
  const board = boardFixture();
  board.participations = [{ ...board.participations[0], stage_id: board.stages[1].id }];
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [board.stages[0].id, board.stages[2].id], criteria: [{ id: "c", label: "Entrevista", kind: "manual", params: {}, importance: "required" }] } });
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findAllByLabelText(/Ajuste al checklist/);
  const id = board.participations[0].id;
  fireEvent.click(screen.getByRole("button", { name: `Mover ${id} a ${board.stages[0].name}` }));
  const back = await screen.findByRole("alertdialog");
  expect(within(back).queryByRole("region", { name: "Antes de mover" })).not.toBeInTheDocument();
  fireEvent.click(within(back).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: `Mover ${id} a ${board.stages[2].name}` }));
  expect(within(await screen.findByRole("alertdialog")).getByRole("region", { name: "Antes de mover" })).toBeVisible();
});
it("reviews pending criteria from the confirmation in the sheet Checklist tab without moving", async () => {
  const board = boardFixture();
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [board.stages[1].id], criteria: [{ id: "c", label: "Entrevista", kind: "manual", params: {}, importance: "required" }] } });
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findAllByLabelText(/Ajuste al checklist/);
  fireEvent.click(screen.getByRole("button", { name: `Mover ${board.participations[0].id} a ${board.stages[1].name}` }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Revisar en la ficha" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(await screen.findByRole("tab", { name: "Checklist" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("region", { name: "Checklist del candidato" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toBeVisible();
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("integrates card fit and stable best-fit ordering in columns", async () => {
  render(<MovementBoard vacancyId="vacancy" />);
  expect(await screen.findByText("1/1 obligatorios")).toBeVisible();
  const column = screen.getByRole("region", { name: "Candidatos en Entrada" });
  const toolbar = screen.getByRole("group", { name: "Filtros del pipeline" });
  const sort = within(toolbar).getByRole("combobox", { name: "Orden" });
  expect(sort).toHaveTextContent("Orden: Llegada");
  fireEvent.click(sort);
  fireEvent.click(await screen.findByRole("option", { name: "Mejor ajuste (checklist)" }));
  expect(sort).toHaveTextContent("Orden: Mejor ajuste");
  expect(within(column).getAllByRole("listitem").map(row => row.textContent)).toEqual([expect.stringContaining("Beatriz"), expect.stringContaining("Ana"), expect.stringContaining("Carlos")]);
});
it.each([ ["Cumple todos los obligatorios", "Beatriz"], ["Con obligatorios sin evaluar", "Ana Pérez"], ["No cumple algún obligatorio", "Carlos"] ])("integrates %s with counts", async (option, candidate) => {
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByText("1/1 obligatorios");
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const sheet = await screen.findByRole("dialog", { name: "Filtrar candidatos" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Checklist" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `${option} 1` }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Checklist" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Ver 1 candidato" }));
  expect(screen.getByRole("button", { name: `Ver detalle de ${candidate}` })).toBeVisible();
  expect(screen.getAllByRole("button", { name: /Ver detalle de/ })).toHaveLength(1);
});
