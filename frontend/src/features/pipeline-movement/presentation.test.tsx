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
  expect(screen.getByLabelText("Cobertura")).toHaveTextContent("1 plaza cubierta");
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
it("stretches every drop surface and scrolls only its cards below a fixed heading", async () => {
  const board = boardFixture();
  await act(async () => render(<BoardColumns board={board} pending={new Set()} locked={false} notices={{}} onMove={vi.fn()} onDetail={vi.fn()} onDisposition={vi.fn()} />));
  const region = screen.getByRole("region", { name: "Columnas del pipeline" });
  expect(region).toHaveClass("md:flex-1", "md:min-h-0", "h-[min(70dvh,640px)]");
  const track = region.querySelector('[data-pf-board-track]');
  expect(track).toHaveClass("h-full", "items-stretch", "min-h-[448px]");
  for (const stage of [...board.stages, board.exit]) {
    const column = screen.getByRole("region", { name: `${stage.name}: ${stage.count} ${stage.count === 1 ? "candidato" : "candidatos"}` });
    expect(column).toHaveAttribute("data-pf-published-column");
    expect(column).toHaveClass("flex", "flex-col", "min-h-[420px]");
    expect(column).not.toHaveClass("self-start");
    const listScroll = within(column).getByRole("region", { name: `Candidatos en ${stage.name}` });
    expect(listScroll).toHaveAttribute("data-slot", "scroll-area");
    expect(listScroll).toHaveClass("pf-column-scroll", "flex-1", "min-h-0");
    // Base UI hides the default vertical scrollbar when jsdom reports no
    // overflow. Assert the real viewport, not geometry-dependent visibility.
    const viewport = listScroll.querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport).toBeInTheDocument();
    expect(listScroll.querySelector('[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]')).not.toBeInTheDocument();
    const heading = within(column).getByRole("heading", { name: stage.name });
    expect(listScroll).not.toContainElement(heading);
    expect(heading.parentElement).toHaveClass("shrink-0");
    if (stage.count) {
      expect(viewport).toContainElement(within(column).getByRole("list"));
      expect(viewport).toContainElement(screen.getByRole("button", { name: "Arrastrar Ana Pérez" }));
    } else {
      const empty = within(listScroll).getByText("Sin candidatos en esta etapa");
      expect(viewport).toContainElement(empty);
      expect(empty).toHaveClass("h-24", "border-dashed");
      expect(empty).not.toHaveClass("h-full", "flex-1");
    }
  }
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
