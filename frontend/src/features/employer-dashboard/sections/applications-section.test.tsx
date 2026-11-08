import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("../test-utils")).popoverMock());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { drillFor } from "../drilldown";
import { origin } from "../test-fixtures";
import { ready } from "../test-utils";
import { ApplicationsSection } from "./applications-section";

afterEach(cleanup);
const totals = (days: ReturnType<typeof origin>["by_day"]) => [days.reduce((s, d) => s + d.organic, 0), days.reduce((s, d) => s + d.manual, 0)];

describe("Postulaciones (last, artboard 09)", () => {
  it("plots a 7-day average for 30 days, with raw-sum legend totals", () => {
    const data = origin(30);
    const [organic, manual] = totals(data.by_day);
    render(<ApplicationsSection state={ready(data)} window={30} drill={drillFor(30)} />);
    const chart = screen.getByRole("heading", { level: 3, name: "Postulaciones por día" }).closest("article") as HTMLElement;
    expect(chart).toHaveTextContent("Últimos 30 días · promedio diario de 7 días");
    expect(chart).toHaveTextContent(new RegExp(`Orgánicas\\s*${organic}`));
    expect(chart).toHaveTextContent(new RegExp(`Manuales\\s*${manual}`));
    expect(within(chart).getByRole("img", { name: /promedio diario de 7 días de postulaciones orgánicas y manuales, del 16 de octubre al 8 de noviembre/ })).toBeInTheDocument();
  });

  it("plots raw daily values for 7 days", () => {
    render(<ApplicationsSection state={ready(origin(7))} window={7} drill={drillFor(7)} />);
    expect(screen.getByText("Últimos 7 días")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Postulaciones orgánicas y manuales por día, del 2 al 8 de noviembre/ })).toBeInTheDocument();
  });

  it("shows the raw daily counts behind «Ver como tabla», newest first", async () => {
    render(<ApplicationsSection state={ready(origin(30))} window={30} drill={drillFor(30)} />);
    await userEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(31);
    expect(rows[1]).toHaveTextContent("dom 8 nov");
    expect(screen.getByRole("button", { name: "Ver como gráfica" })).toBeInTheDocument();
  });

  it("has an empty state when nobody applied in the window", () => {
    const data = origin(30);
    render(<ApplicationsSection state={ready({ ...data, by_day: data.by_day.map(d => ({ ...d, organic: 0, manual: 0 })) })} window={30} drill={drillFor(30)} />);
    expect(screen.getByRole("heading", { name: "Sin postulaciones en el periodo" })).toBeInTheDocument();
  });

  it("links the legend totals to the applications list when on", () => {
    render(<ApplicationsSection state={ready(origin(30))} window={30} drill={drillFor(30, true)} />);
    const href = screen.getByRole("link", { name: /postulaciones manuales de los últimos 30 días/ }).getAttribute("href")!;
    expect(Object.fromEntries(new URL(href, "https://app.test").searchParams)).toEqual({ kind: "applications", window: "30", channel: "manual" });
  });
});
