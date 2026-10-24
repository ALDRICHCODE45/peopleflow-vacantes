import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChartAreaInteractive, SERIES_COLORS, formatTickLabel } from "./chart-area-interactive";
const captured = vi.hoisted(() => ({ dates: [] as string[] }));
vi.mock("recharts", () => ({ AreaChart: ({ data, children }: { data: { date: string }[]; children: React.ReactNode }) => { captured.dates = data.map(day => day.date); return <div>{children}</div>; }, Area: () => null, CartesianGrid: () => null, XAxis: () => null }));
vi.mock("@/components/ui/chart", () => ({ ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ChartTooltip: () => null, ChartTooltipContent: () => null }));
afterEach(cleanup);
it("uses the last 90/30/7 entries with real series and no fixed reference date", () => {
  const data = Array.from({ length: 90 }, (_, i) => ({ date: `day-${i}`, organic: i, manual: i + 1 }));
  render(<ChartAreaInteractive data={data} />);
  expect(screen.getByText("Origen de las postulaciones")).toBeInTheDocument(); expect(captured.dates).toHaveLength(90);
  fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" })); expect(captured.dates).toEqual(data.slice(-30).map(day => day.date));
  fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" })); expect(captured.dates).toEqual(data.slice(-7).map(day => day.date));
  expect(screen.getByText(/Orgánicas: postulaciones de candidatos/)).toBeInTheDocument(); expect(screen.queryByText("Directas")).toBeNull();
});
it("tells the two series apart: distinct hues and a legend with a swatch per series", () => {
  const { container } = render(<ChartAreaInteractive data={[{ date: "2026-10-23", organic: 1, manual: 2 }]} />);
  const items = [...container.querySelectorAll("[data-pf-chart-legend] li")];
  expect(items.map(item => item.textContent)).toEqual(["Orgánicas", "Manuales"]);
  const swatches = items.map(item => item.querySelector("[data-pf-chart-swatch]")?.getAttribute("style") ?? "");
  // The legend sits outside ChartContainer (which defines --color-*), so swatches use the series colors directly.
  expect(swatches).toEqual([expect.stringContaining("var(--brand-decorative-strong)"), expect.stringContaining("var(--status-info)")]);
  // Both were violet; manual now uses the info blue. Organic avoids --primary, a dark button fill in dark mode.
  expect(SERIES_COLORS).toEqual({ organic: "var(--brand-decorative-strong)", manual: "var(--status-info)" });
});
it("formats date-only Mexico days without shifting the date", () => { expect(formatTickLabel("2026-10-23")).toContain("23"); });
