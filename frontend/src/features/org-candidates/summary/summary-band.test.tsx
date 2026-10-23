import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SummaryBand } from "./summary-band";
import { summary } from "./test-fixtures";
afterEach(cleanup);
const labels = ["Total de candidatos", "En procesos activos", "Agregados esta semana"];
it("renders the page heading and three labelled metric groups without an add button", () => {
  render(<SummaryBand data={summary} pending={false} failure={null} onRetry={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Candidatos de mi organización" })).toBeVisible();
  expect(screen.getByText("TU RED DE TALENTO")).toBeVisible();
  expect(screen.getByText("Cada persona, una posibilidad. Todo tu talento, en un solo lugar.")).toBeVisible();
  labels.forEach((label, i) => {
    const group = screen.getByRole("group", { name: label });
    expect(within(group).getByText(String([8, 7, 3][i]))).toHaveClass("tabular-nums");
    expect(within(group).getByText(["en tu organización", "con nuevas oportunidades", "tu red sigue creciendo"][i])).toBeVisible();
  });
  expect(screen.queryByRole("button", { name: /Agregar candidato/ })).not.toBeInTheDocument();
});
it("keeps the metric composition while loading without inventing zero counts", () => {
  const { container, rerender } = render(<SummaryBand data={null} pending failure={null} onRetry={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando resumen");
  expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  expect(screen.queryByText("0")).not.toBeInTheDocument();
  const slots = () => [...container.querySelectorAll('[data-slot]:not([data-slot="skeleton"])')].map(el => el.getAttribute("data-slot"));
  const loadingSlots = slots();
  rerender(<SummaryBand data={summary} pending={false} failure={null} onRetry={vi.fn()} />);
  expect(slots()).toEqual(loadingSlots);
});
it("shows a compact error and retries without a blocking dialog", async () => {
  const onRetry = vi.fn();
  render(<SummaryBand data={null} pending={false} failure={{ ok: false, reason: "server_error", reference: { status: 500 } }} onRetry={onRetry} />);
  expect(screen.getByRole("status")).toHaveTextContent("No pudimos cargar el resumen");
  await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});
it("preserves useful data during refresh and subsequent errors", () => {
  const { rerender } = render(<SummaryBand data={summary} pending failure={null} onRetry={vi.fn()} />);
  expect(screen.getByText("8")).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<SummaryBand data={summary} pending={false} failure={{ ok: false, reason: "no_response", reference: {} }} onRetry={vi.fn()} />);
  expect(screen.getByText("8")).toBeVisible();
  expect(screen.getByText("No pudimos cargar el resumen")).toBeVisible();
});
it("renders real zero counts", () => {
  render(<SummaryBand data={{ total: 0, with_active_process: 0, added_last_7_days: 0, by_kind: { manual: 0, organic: 0 } }} pending={false} failure={null} onRetry={vi.fn()} />);
  expect(screen.getAllByText("0")).toHaveLength(3);
});
