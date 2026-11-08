import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The detail page is off until T10b: links are tested by switching the flag here, never in the product code.
const drill = vi.hoisted(() => ({ enabled: false }));
vi.mock("../drilldown", async importOriginal => {
  const actual = await importOriginal<typeof import("../drilldown")>();
  return { ...actual, drilldownHref: (...[target, filters, options]: Parameters<typeof actual.drilldownHref>) => actual.drilldownHref(target, filters, { ...options, enabled: drill.enabled }) };
});
// Same boundary as metrics-workspace.test: the real Base UI popover close path refocus-loops under jsdom.
vi.mock("@/components/ui/popover", async () => {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), ...(children ? { children } : {}) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
import type { MetricsSummary } from "../model";
import { summary, summaryV2 } from "../test-fixtures";
import { SummaryStrip } from "./summary-strip";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: MetricsSummary) => ({ status: "ready" as const, data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: MetricsSummary = summaryV2()) => render(<SummaryStrip state={ready(data)} filters={{}} period={period} />);
const kpi = (name: string) => within(screen.getByRole("article", { name }));
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);
const pill = (container: ReturnType<typeof kpi>, label: string) => container.getByText(label).closest("[data-tone]");

beforeEach(() => { drill.enabled = false; });
afterEach(cleanup);

describe("Resumen strip (artboard 07)", () => {
  it("leads with the on-time hero: rate, its fraction and the change in points", () => {
    show();
    const hero = kpi("Entregas a tiempo");
    expect(hero.getByText("67%")).toBeInTheDocument();
    expect(hero.getByText("20 de 30")).toBeInTheDocument();
    expect(hero.getByText(/entregas con fecha cumplida/)).toBeInTheDocument();
    expect(pill(hero, "+17 pts")).toHaveAttribute("data-tone", "positive");
    expect(hero.getByText("17 puntos más que el periodo anterior")).toBeInTheDocument();
    expect(hero.getByText("vs periodo anterior")).toBeInTheDocument();
  });

  it("shows the four headline cards with their deltas, lower being better for days and reassignments", () => {
    show();
    expect(kpi("Vacantes asignadas").getByText("42")).toBeInTheDocument();
    expect(pill(kpi("Vacantes asignadas"), "+4")).toHaveAttribute("data-tone", "positive");
    expect(kpi("Mediana para cerrar").getByText("23")).toBeInTheDocument();
    expect(kpi("Mediana para cerrar").getByText("días hábiles")).toBeInTheDocument();
    expect(pill(kpi("Mediana para cerrar"), "−4 días")).toHaveAttribute("data-tone", "positive");
    expect(kpi("Placements").getByText("25")).toBeInTheDocument();
    expect(pill(kpi("Placements"), "+6")).toHaveAttribute("data-tone", "positive");
    expect(kpi("Reasignaciones").getByText("6")).toBeInTheDocument();
    expect(pill(kpi("Reasignaciones"), "−3")).toHaveAttribute("data-tone", "positive");
  });

  it("marks a worse change with the negative tone", () => {
    const data = summaryV2();
    show({ ...data, headline: { ...data.headline!, reassignments: { current: 9, previous: 6 }, assigned: { current: 30, previous: 38 } } });
    expect(pill(kpi("Reasignaciones"), "+3")).toHaveAttribute("data-tone", "negative");
    expect(pill(kpi("Vacantes asignadas"), "−8")).toHaveAttribute("data-tone", "negative");
  });

  it("says «Sin datos suficientes» for a missing median or rate, without a delta, and shows a real 0", () => {
    const data = summaryV2();
    show({
      ...data,
      headline: {
        ...data.headline!,
        on_time_rate: { current: { value: null, numerator: 0, denominator: 0 }, previous: data.headline!.on_time_rate.previous },
        median_business_days_to_close: { current: null, previous: 27 },
        placements: { current: 0, previous: 19 },
      },
    });
    expect(kpi("Entregas a tiempo").getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(kpi("Entregas a tiempo").queryByText("vs periodo anterior")).not.toBeInTheDocument();
    expect(kpi("Mediana para cerrar").getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(kpi("Mediana para cerrar").queryByText("vs periodo anterior")).not.toBeInTheDocument();
    expect(kpi("Placements").getByText("0")).toBeInTheDocument();
  });

  it("falls back to the v1 fields without deltas when the answer has no headline", () => {
    show(summary());
    expect(kpi("Entregas a tiempo").getByText("67%")).toBeInTheDocument();
    expect(kpi("Vacantes asignadas").getByText("42")).toBeInTheDocument();
    expect(kpi("Mediana para cerrar").getByText("23")).toBeInTheDocument();
    expect(kpi("Placements").getByText("25")).toBeInTheDocument();
    expect(kpi("Reasignaciones").getByText("6")).toBeInTheDocument();
    expect(screen.queryByText("vs periodo anterior")).not.toBeInTheDocument();
  });

  it("keeps every figure as plain text while the detail page is off", () => {
    show();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("opens each figure's records per contract §4.1, previous values with the previous period", () => {
    drill.enabled = true;
    show();
    expect(query(screen.getByRole("link", { name: "Ver las 30 entregas con fecha cumplida, 67% a tiempo" })))
      .toEqual({ kind: "deliveries", result: "on_time,late,overdue", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 42 vacantes asignadas" }))).toEqual({ kind: "vacancies", scope: "assigned", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 18 vacantes cubiertas por días para cerrar" })))
      .toEqual({ kind: "vacancies", scope: "closed", close_reason: "filled", sort: "business_days_to_close", ...period });
    expect(query(screen.getByRole("link", { name: "Ver los 25 placements" }))).toEqual({ kind: "placements", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 6 reasignaciones" }))).toEqual({ kind: "reassignments", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 38 vacantes asignadas del periodo anterior" })))
      .toEqual({ kind: "vacancies", scope: "assigned", from: "2026-05-02", to: "2026-07-31" });
    expect(query(screen.getByRole("link", { name: "Ver las 20 entregas con fecha cumplida del periodo anterior" })))
      .toEqual({ kind: "deliveries", result: "on_time,late,overdue", from: "2026-05-02", to: "2026-07-31" });
  });

  it("never links a 0", () => {
    drill.enabled = true;
    const data = summaryV2();
    show({ ...data, headline: { ...data.headline!, placements: { current: 0, previous: 0 } } });
    expect(kpi("Placements").getByText("0")).toBeInTheDocument();
    expect(kpi("Placements").queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps the explanation behind «Cómo se calcula», with no sentence under the title", async () => {
    show();
    const heading = screen.getByRole("heading", { level: 2, name: "Resumen" });
    expect(heading.parentElement?.querySelector("p")).toBeNull();
    expect(screen.queryByText(/Días hábiles entre la apertura y el cierre/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Resumen" }));
    const help = screen.getByRole("dialog");
    expect(within(help).getByText("Mediana para cerrar")).toBeInTheDocument();
    expect(within(help).getByText(/Días hábiles entre la apertura y el cierre/)).toBeInTheDocument();
  });
});
