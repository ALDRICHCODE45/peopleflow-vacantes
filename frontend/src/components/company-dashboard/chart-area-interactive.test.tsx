import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { ChartAreaInteractive, formatTickLabel } from "./chart-area-interactive";
import { dashboard } from "@/features/employer-dashboard/test-fixtures";
const source = readFileSync("src/components/company-dashboard/chart-area-interactive.tsx", "utf8");
const captured = vi.hoisted(() => ({ dates: [] as string[], series: [] as string[], curves: [] as string[] }));
vi.mock("recharts", async importOriginal => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, AreaChart: ({ data, children }: { data: { date: string }[]; children: React.ReactNode }) => { captured.dates = data.map(day => day.date); return <svg>{children}</svg>; }, Area: ({ dataKey, type }: { dataKey: string; type?: string }) => { captured.series.push(dataKey); captured.curves.push(type ?? ""); return null; }, CartesianGrid: () => null, XAxis: () => null, Tooltip: () => null,
    Legend: ({ content }: { content: React.ReactElement }) => <foreignObject><div data-testid="legend">{React.cloneElement(content as React.ReactElement<{ payload: unknown[] }>, { payload: [{ dataKey: "organic", color: "var(--color-organic)" }, { dataKey: "manual", color: "var(--color-manual)" }] })}</div></foreignObject> };
});
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.stubGlobal("innerWidth", 1280); captured.series = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("approved application-source chart with real dates", () => {
  it("titles the chart and keeps the card marker and header slots", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    const card = document.querySelector("[data-pf-chart-card]");
    expect(card).toHaveAttribute("data-slot", "card");
    for (const slot of ["card-title", "card-description", "card-action", "card-content"]) expect(card?.querySelector(`[data-slot='${slot}']`)).not.toBeNull();
    expect(screen.getByText("Origen de las postulaciones")).toBeInTheDocument();
    expect(screen.getByText("Reparto de los últimos 3 meses")).toBeInTheDocument();
  });
  it("switches real 90/30/7-day windows relative to the latest data", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    expect(captured.dates).toEqual(dashboard.origin_by_day.map(day => day.date));
    for (const days of [30, 7]) {
      fireEvent.click(screen.getByRole("button", { name: `Últimos ${days} días` }));
      expect(captured.dates).toEqual(dashboard.origin_by_day.slice(-days).map(day => day.date));
      expect(screen.getByText(`Reparto de los últimos ${days} días`)).toBeInTheDocument();
    }
  });
  it("shows the compact range label, not the raw value", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    expect(screen.getByRole("combobox", { name: "Seleccionar período" })).toHaveTextContent("Últimos 3 meses");
  });
  it("uses both real series, different brand tones and a legend inside the chart context", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    expect([...new Set(captured.series)]).toEqual(["manual", "organic"]);
    expect(screen.getByTestId("legend").closest("[data-slot='chart']")).not.toBeNull();
    expect(source).toContain("ChartLegendContent");
    const legend = screen.getByTestId("legend");
    expect(legend).toHaveTextContent("Orgánicas"); expect(legend).toHaveTextContent("Manuales");
    expect(legend.querySelectorAll('[style*="background-color"]')).toHaveLength(2);
    const css = Array.from(document.querySelectorAll("style")).map(node => node.textContent).join("\n");
    expect(css).toContain("--color-organic: var(--primary)");
    expect(css).toContain("--color-manual: var(--brand-decorative-strong)");
    expect(source).toContain('label: "Orgánicas"'); expect(source).toContain('label: "Manuales"');
  });
  it("preserves stacking, gradients and tooltip instead of replacing the approved chart", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    expect(document.querySelectorAll("linearGradient")).toHaveLength(2);
    expect(source.match(/stackId="a"/g)).toHaveLength(2);
    expect(source).toContain("ChartTooltipContent");
  });
  it("keeps deterministic UTC labels for date-only Mexico days", () => {
    expect(formatTickLabel("2026-10-23")).toContain("23");
    expect(formatTickLabel("2024-04-03")).toBe("3 abr");
  });
  it("keeps the approved desktop and concise mobile headings and a segmented range control sized by its labels", () => {
    render(<ChartAreaInteractive data={dashboard.origin_by_day} />);
    expect(screen.getByText("Origen de las postulaciones")).toHaveClass("@[540px]/card:inline");
    expect(screen.getByText("Postulaciones")).toHaveClass("@[540px]/card:hidden");
    const range = document.querySelector("[data-slot='toggle-group']");
    expect(range).toHaveAttribute("data-variant", "segmented");
    expect(range).not.toHaveClass("w-88");
  });
});

it("draws monotone curves so sparse real counts never dip below zero", () => {
  captured.curves = [];
  render(<ChartAreaInteractive data={[{ date: "2026-10-22", organic: 0, manual: 0 }, { date: "2026-10-23", organic: 3, manual: 0 }]} />);
  expect(captured.curves.length).toBeGreaterThan(0);
  expect(new Set(captured.curves)).toEqual(new Set(["monotone"]));
});
