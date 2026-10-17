import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardCoverage, MovementDate } from "./board-states";
import { BoardColumns } from "./board-columns";
import { boardFixture } from "./board-fixture";
import { filePresentation, initials, stageClass } from "./pipeline-presentation";
afterEach(cleanup);
it("uses short Mexican dates, with no year on card metadata", () => {
  const { rerender } = render(<MovementDate value="2026-10-17T12:00:00Z" />);
  expect(screen.getByText("17 oct 2026")).toBeVisible();
  rerender(<MovementDate value="2026-10-17T12:00:00Z" compact />);
  expect(screen.getByText("17 oct")).toBeVisible();
  rerender(<MovementDate value="2026-10-17T20:32:00Z" withTime />);
  expect(screen.getByText("17 oct 2026, 14:32")).toBeVisible();
});
it("distinguishes current coverage from a historical milestone and omits unknown capacity", () => {
  const coverage = { covered: 1, required: 2, full_coverage_reached_at: "2026-10-17T12:00:00Z" };
  const { rerender } = render(<BoardCoverage coverage={coverage} />);
  expect(screen.getByText(/Se completó el/)).toHaveTextContent("Se completó el 17 oct 2026");
  expect(screen.queryByText("Cobertura completa")).not.toBeInTheDocument();
  rerender(<BoardCoverage coverage={{ ...coverage, covered: 2 }} />);
  expect(screen.getByText("Cobertura completa")).toBeVisible();
  rerender(<BoardCoverage coverage={{ ...coverage, required: null }} />);
  expect(screen.getByLabelText("Cobertura")).toHaveTextContent("1 plazas cubiertas");
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
it("keeps compact empty columns, exit guidance and card actions, without persistent success", async () => {
  await act(async () => render(<BoardColumns board={boardFixture()} pending={new Set()} locked={false} notices={{ person: { tone: "success", text: "Candidato movido" } }} onMove={vi.fn()} onDetail={vi.fn()} onDisposition={vi.fn()} />));
  expect(screen.getAllByText("Sin candidatos en esta etapa")).toHaveLength(4);
  expect(screen.getByLabelText("Se llega descartando, no moviendo")).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: "Acciones de Ana Pérez" })).toBeEnabled();
  expect(screen.queryByText("Candidato movido")).not.toBeInTheDocument();
  const card = screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }).closest('[data-slot="card"]')!;
  expect(within(card as HTMLElement).getByText(/En la etapa desde/)).toHaveTextContent("En la etapa desde 16 oct");
});
it("maps document extensions, Unicode initials and strict stage kinds without demo data", () => {
  expect(filePresentation("Mi CV.PDF")).toBe("pdf");
  expect(filePresentation("Mi CV.docx")).toBe("word");
  expect(initials("  Ana   Pérez ")).toBe("AP");
  expect(stageClass("custom")).toBe("stage-neutral");
  expect(stageClass("screening_ok")).toBe("stage-review");
  expect(stageClass("in_process")).toBe("stage-process");
});
it("retains a compact error while pending cards keep their action slot and lock", async () => {
  const props = { board: boardFixture(), locked: false, onMove: vi.fn(), onDetail: vi.fn(), onDisposition: vi.fn() };
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<BoardColumns {...props} pending={new Set()} notices={{ person: { tone: "error", text: "No se guardó el cambio" } }} />); });
  expect(screen.getByText("No se guardó el cambio").closest('[role="status"]')).toHaveAttribute("id", "move-status-person");
  await act(async () => view.rerender(<BoardColumns {...props} pending={new Set(["person"])} notices={{}} />));
  expect(screen.getByRole("button", { name: "Acciones de Ana Pérez" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toBeDisabled();
  expect(screen.getByLabelText("Guardando cambio…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }).closest('[data-slot="card"]')).toHaveClass("opacity-55");
});
