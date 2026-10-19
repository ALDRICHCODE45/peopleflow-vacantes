import "./board-filter-popover-test-double";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { boardFixture } from "./board-fixture";
import { loadBoardAction } from "./actions";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn() }));
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board, locked: true, structureLocked: true }) }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn(async () => ({ ok: false })) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function openBoard(withSubstates = false) {
  const board = boardFixture();
  if (withSubstates) {
    board.stages[2].kind = "in_process";
    board.substates = [{ id: "tech", name: "Entrevista técnica" }, { id: "offer", name: "Oferta" }];
    board.participations[0].stage_id = board.stages[2].id;
    board.participations[0].substate_id = "tech";
  } else board.substates = [];
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  render(<MovementBoard vacancyId="vacancy" />);
  const trigger = await screen.findByRole("button", { name: "Filtros" });
  fireEvent.click(trigger);
  const sheet = await screen.findByRole("dialog", { name: "Filtrar candidatos" });
  await waitFor(() => expect(within(sheet).getByRole("button", { name: "Cerrar filtros" })).toHaveFocus());
  return { trigger, sheet };
}
it("compact reference anatomy hides options until opened and agrees singular counts", async () => {
  const { sheet } = await openBoard();
  expect(within(sheet).getByText("Encuentra los perfiles que necesitas dentro de tu pipeline.")).toBeVisible();
  expect(sheet.querySelector('[data-slot="filter-icon"]')).toHaveClass("size-10", "bg-primary/10");
  expect(within(sheet).getByText("PROCESO DE SELECCIÓN")).toBeVisible();
  expect(within(sheet).getByText("CANDIDATOS DESCARTADOS")).toBeVisible();
  expect(within(sheet).getByRole("button", { name: "Etapa del pipeline" })).toHaveTextContent("Todas las etapas");
  expect(within(sheet).getByRole("button", { name: "Motivo de descarte" })).toHaveTextContent("Todos los motivos");
  expect(within(sheet).queryByRole("button", { name: "Subestado" })).not.toBeInTheDocument();
  expect(sheet.querySelectorAll('[data-slot="popover-trigger"]')).toHaveLength(2);
  expect(within(sheet).queryAllByRole("checkbox")).toHaveLength(0);
  expect(within(sheet).getByText(/Las opciones de un mismo filtro se suman/)).toHaveTextContent("ambas condiciones");
  expect(within(sheet).getByText("1 candidato coincide")).toBeVisible();
  expect(within(sheet).getByText("Sin filtros activos")).toBeVisible();
  expect(within(sheet).getByRole("button", { name: "Limpiar" })).toBeDisabled();
  expect(within(sheet).getByRole("button", { name: "Ver 1 candidato" })).toBeVisible();
});
it("searchable multiselect applies live, keeps quiet zero counts, clears chips and returns focus", async () => {
  const { trigger, sheet } = await openBoard(true);
  expect(sheet.querySelectorAll('[data-slot="popover-trigger"]')).toHaveLength(3);
  expect(within(sheet).getByText(/Las opciones de un mismo filtro se suman/)).toHaveTextContent("todas las condiciones");
  fireEvent.click(within(sheet).getByRole("button", { name: "Subestado" }));
  const search = screen.getByRole("textbox", { name: "Buscar opciones…" });
  fireEvent.change(search, { target: { value: "oferta" } });
  expect(screen.queryByRole("checkbox", { name: "Entrevista técnica 1" })).not.toBeInTheDocument();
  const option = screen.getByRole("checkbox", { name: "Oferta 0" });
  expect(option.closest("label")?.querySelector("[data-slot='option-count']")).toHaveClass("text-muted-foreground", "tabular-nums", "opacity-50");
  fireEvent.click(option);
  expect(within(sheet).getByRole("button", { name: "Ver 0 candidatos" })).toBeVisible();
  fireEvent.change(search, { target: { value: "" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Entrevista técnica 1" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Subestado" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Ver 1 candidato" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByText("Mostrando 1 de 1 candidato")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Quitar Subestado: Entrevista técnica" }));
  expect(screen.getByText("Mostrando 0 de 1 candidato")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
  expect(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" })).toBeVisible();
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it("discard popup groups decisions and exposes multi-selection guidance", async () => {
  const { sheet } = await openBoard();
  fireEvent.click(within(sheet).getByRole("button", { name: "Motivo de descarte" }));
  expect(screen.getByRole("group", { name: "Decisión de la empresa" })).toBeVisible();
  expect(screen.getByRole("group", { name: "Decisión del candidato" })).toBeVisible();
  expect(screen.getByText("Puedes seleccionar más de una opción.")).toBeVisible();
  fireEvent.click(within(screen.getByRole("group", { name: "Decisión del candidato" })).getByRole("checkbox", { name: "Otro 0" }));
  expect(within(sheet).getByRole("button", { name: "Ver 0 candidatos" })).toBeVisible();
});
it("stage selections summarize compactly, keep full-board counts and clear live", async () => {
  const { sheet } = await openBoard();
  const stages = within(sheet).getByRole("button", { name: "Etapa del pipeline" });
  fireEvent.click(stages);
  expect(screen.getByText("Opciones")).toBeVisible();
  const options = screen.getAllByRole("checkbox");
  options.slice(0, 3).forEach(option => fireEvent.click(option));
  expect(stages).toHaveTextContent("3 etapas");
  expect(within(sheet).getByText("3 filtros activos")).toBeVisible();
  expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName(/1$/);
  const search = screen.getByRole("textbox", { name: "Buscar opciones…" });
  fireEvent.change(search, { target: { value: "no existe" } });
  expect(screen.getByText("No se encontraron opciones.")).toBeVisible();
  fireEvent.change(search, { target: { value: "" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Limpiar" }));
  screen.getAllByRole("checkbox").forEach(option => expect(option).not.toBeChecked());
  expect(stages).toHaveTextContent("Todas las etapas");
  expect(within(sheet).getByRole("button", { name: "Limpiar" })).toBeDisabled();
});
it("plural results agree", async () => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "second" });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  render(<MovementBoard vacancyId="vacancy" />);
  fireEvent.click(await screen.findByRole("button", { name: "Filtros" }));
  expect(await screen.findByText("2 candidatos coinciden")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ver 2 candidatos" })).toBeVisible();
});
it("coverage and delivery share label/value/bar/secondary anatomy in one progress group", async () => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardFixture() });
  render(<MovementBoard vacancyId="vacancy" />);
  const group = await screen.findByRole("group", { name: "Progreso de la vacante" });
  for (const label of ["Cobertura", "Entrega"]) {
    const metric = within(group).getByLabelText(label);
    expect(metric.querySelectorAll('[data-slot="metric-label"], [data-slot="metric-value"], [data-slot="progress"], [data-slot="metric-detail"]')).toHaveLength(4);
  }
});
