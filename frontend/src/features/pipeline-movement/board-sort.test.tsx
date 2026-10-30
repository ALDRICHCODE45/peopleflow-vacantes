import "./board-filter-popover-test-double";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { boardFixture } from "./board-fixture";
import { loadBoardAction, moveParticipationAction } from "./actions";
import { loadChecklistAction, loadChecklistMarksAction } from "@/features/vacancy-checklist/actions";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), moveParticipationAction: vi.fn() }));
vi.mock("./candidate-menu", () => ({ CandidateMenu: () => null }));
vi.mock("@/features/vacancy-checklist/actions", () => ({ loadChecklistAction: vi.fn(), loadChecklistMarksAction: vi.fn() }));
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board, locked: true, structureLocked: true }) }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn(async () => ({ ok: false })) }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
// Replace only Select's portal/focus boundary, retaining controlled product values.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { value: string; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: "", items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Value & { onValueChange: Value["change"]; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="board-sort-options" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox" id="board-sort-options">{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
// Keep the real tooltip focus/hover logic; omit jsdom's looping anchored positioning.
vi.mock("@/components/ui/tooltip", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/tooltip")>();
  const React = await import("react");
  const Open = React.createContext(false);
  return { ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return <actual.Tooltip onOpenChange={setOpen}><Open.Provider value={open}>{children}</Open.Provider></actual.Tooltip>;
    },
    TooltipContent: ({ children }: { children: ReactNode }) => React.useContext(Open) ? <div role="tooltip">{children}</div> : null,
  };
});
const explanation = "Ordena cada columna por los criterios de la checklist: obligatorios cumplidos, luego deseables. No mueve ni descarta candidatos.";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  const board = boardFixture();
  const first = board.participations[0];
  first.profile.years_of_experience = null;
  board.participations = [first, { ...first, id: "second", candidate: { ...first.candidate, full_name: "Beatriz" }, profile: { ...first.profile, years_of_experience: "5" } }, { ...first, id: "third", candidate: { ...first.candidate, full_name: "Carlos" }, profile: { ...first.profile, years_of_experience: "1" } }];
  board.stages[0].count = 3;
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [], criteria: [{ id: "c", label: "Experiencia", kind: "min_years_experience", params: { min: "3" }, importance: "required" }] } });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [] } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount() {
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByText("1/1 obligatorios");
}
function names(column = "Entrada") { return within(screen.getByRole("region", { name: `Candidatos en ${column}` })).getAllByRole("button", { name: /^Ver detalle de/ }).map(card => card.getAttribute("aria-label")); }
function chooseFit() { fireEvent.click(screen.getByRole("option", { name: "Mejor ajuste (checklist)" })); }
it("shows the active order, sorts cards locally and restores arrival order", async () => {
  await mount();
  const original = names();
  expect(screen.getByRole("combobox", { name: "Orden" })).toHaveTextContent("Orden: Llegada");
  chooseFit();
  expect(screen.getByRole("combobox", { name: "Orden" })).toHaveTextContent("Orden: Mejor ajuste");
  expect(names()).toEqual(["Ver detalle de Beatriz", "Ver detalle de Ana Pérez", "Ver detalle de Carlos"]);
  expect(screen.getByRole("status", { name: "Orden de candidatos" })).toHaveTextContent(/^Ordenado por mejor ajuste$/);
  fireEvent.click(screen.getByRole("option", { name: "Llegada" }));
  expect(screen.getByRole("combobox", { name: "Orden" })).toHaveTextContent("Orden: Llegada");
  expect(names()).toEqual(original);
  expect(loadBoardAction).toHaveBeenCalledOnce();
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("announces unchanged order when every column already matches", async () => {
  const result = await vi.mocked(loadBoardAction)("vacancy");
  if (!result.ok) throw new Error("fixture missing");
  result.data.participations = [result.data.participations[1], result.data.participations[0], result.data.participations[2]];
  vi.mocked(loadBoardAction).mockClear();
  await mount(); const original = names(); chooseFit();
  expect(names()).toEqual(original);
  expect(screen.getByRole("status", { name: "Orden de candidatos" })).toHaveTextContent(/^Ya estaban en orden de mejor ajuste$/);
  expect(loadBoardAction).toHaveBeenCalledOnce();
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("ignores global interleaving when each column's visible order is unchanged", async () => {
  const result = await vi.mocked(loadBoardAction)("vacancy");
  if (!result.ok) throw new Error("fixture missing");
  result.data.participations[1].stage_id = result.data.stages[1].id;
  result.data.stages[0].count = 2; result.data.stages[1].count = 1;
  await mount(); const original = names(); const second = names("Revisión"); chooseFit();
  expect(names()).toEqual(original); expect(names("Revisión")).toEqual(second);
  expect(screen.getByRole("status", { name: "Orden de candidatos" })).toHaveTextContent(/^Ya estaban en orden de mejor ajuste$/);
});
it("exposes the explanation on keyboard focus and hover", async () => {
  await mount();
  const help = screen.getByRole("button", { name: "Cómo se ordenan los candidatos" });
  fireEvent.keyDown(document.body, { key: "Tab" });
  fireEvent.focus(help);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(explanation);
  fireEvent.blur(help); fireEvent.mouseLeave(help);
  fireEvent.pointerMove(help, { pointerType: "mouse" });
  fireEvent.mouseEnter(help);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(explanation);
});
it("keeps the sort control hidden without checklist criteria", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { version: "1", reminder_stage_ids: [], criteria: [] } });
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByRole("button", { name: "Ver detalle de Beatriz" });
  expect(screen.queryByRole("combobox", { name: "Orden" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cómo se ordenan los candidatos" })).not.toBeInTheDocument();
  expect(names()).toEqual(["Ver detalle de Ana Pérez", "Ver detalle de Beatriz", "Ver detalle de Carlos"]);
});
