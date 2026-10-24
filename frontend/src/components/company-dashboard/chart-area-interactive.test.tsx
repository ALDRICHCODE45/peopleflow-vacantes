import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChartAreaInteractive, formatTickLabel } from "./chart-area-interactive";
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
it("formats date-only Mexico days without shifting the date", () => { expect(formatTickLabel("2026-10-23")).toContain("23"); });
