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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
import type { ClosuresSection as ClosuresData } from "../model";
import { closures } from "../test-fixtures";
import { ClosuresSection } from "./closures-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: ClosuresData) => ({ status: "ready" as const, data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: ClosuresData = closures()) => render(<ClosuresSection state={ready(data)} filters={{}} period={period} />);
const card = (name: string) => within(screen.getByRole("article", { name }));
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);
const row = (label: string) => within(card("Estado de entregas").getByText(label).closest("li")!);

beforeEach(() => {
  drill.enabled = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Cierres y entregas (artboard 07)", () => {
  it("draws the monthly closures with legend totals for cerradas and cubiertas", () => {
    show();
    const closed = card("Cierres de vacantes");
    expect(closed.getByText("Cerradas").parentElement).toHaveTextContent("Cerradas23");
    expect(closed.getByText("Cubiertas").parentElement).toHaveTextContent("Cubiertas18");
    expect(screen.getByRole("img", { name: /Vacantes cerradas y cubiertas por mes/ })).toBeInTheDocument();
    expect(closed.queryByRole("table")).not.toBeInTheDocument();
  });

  it("swaps the chart for a table and back, never both at once", async () => {
    show();
    const closed = card("Cierres de vacantes");
    await userEvent.click(closed.getByRole("button", { name: "Ver como tabla" }));
    const table = closed.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Mes", "Cerradas", "Cubiertas"]);
    expect(within(table).getByRole("row", { name: /Septiembre de 2026/ })).toHaveTextContent("Septiembre de 202696");
    expect(screen.queryByRole("img", { name: /Vacantes cerradas y cubiertas por mes/ })).not.toBeInTheDocument();
    await userEvent.click(closed.getByRole("button", { name: "Ver como gráfica" }));
    expect(closed.queryByRole("table")).not.toBeInTheDocument();
  });

  it("splits the delivery status with word, count and share in the rule 9 order", () => {
    show();
    const status = card("Estado de entregas");
    expect(status.getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "A tiempo2048%", "Tarde717%", "Vencidas37%", "Pendientes921%", "Sin meta configurada37%",
    ]);
    expect(status.getByRole("group", { name: "Estado de entregas: 20 a tiempo, 7 tarde, 3 vencidas, 9 pendientes, 3 sin meta configurada" })).toBeInTheDocument();
    // The figure opens the deliveries list («Entregas», «42 entregas en el periodo.»), so it counts entregas too.
    expect(status.getByText(/entregas en el periodo/)).toHaveTextContent("42 entregas en el periodo");
  });

  it("keeps every figure as plain text while the detail page is off", () => {
    show();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("opens months, totals and statuses per contract §4.2", async () => {
    drill.enabled = true;
    show();
    expect(query(screen.getByRole("link", { name: "Ver las 9 vacantes cerradas en septiembre de 2026, 6 cubiertas" })))
      .toEqual({ kind: "vacancies", scope: "closed", closed_month: "2026-09", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 23 vacantes cerradas" }))).toEqual({ kind: "vacancies", scope: "closed", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 18 vacantes cubiertas" }))).toEqual({ kind: "vacancies", scope: "closed", close_reason: "filled", ...period });
    expect(query(row("Tarde").getByRole("link", { name: "Ver las 7 entregas tarde" }))).toEqual({ kind: "deliveries", result: "late", ...period });
    expect(query(row("Sin meta configurada").getByRole("link", { name: "Ver las 3 vacantes sin meta configurada" })))
      .toEqual({ kind: "deliveries", result: "not_configured", ...period });
    expect(query(card("Estado de entregas").getByRole("link", { name: "Ver las 42 entregas en el periodo" }))).toEqual({ kind: "deliveries", ...period });
    await userEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));
    expect(query(screen.getByRole("link", { name: "Ver las 6 vacantes cubiertas en septiembre de 2026" })))
      .toEqual({ kind: "vacancies", scope: "closed", closed_month: "2026-09", close_reason: "filled", ...period });
  });

  it("never links a 0 and leaves its segment out of the bar", () => {
    drill.enabled = true;
    show(closures({ delivery_status: { on_time: 20, late: 7, overdue: 0, pending: 9, not_configured: 3 } }));
    expect(row("Vencidas").getByText("0")).toBeInTheDocument();
    expect(row("Vencidas").queryAllByRole("link")).toHaveLength(0);
    expect(card("Estado de entregas").getByRole("group")).not.toHaveAccessibleName(/vencidas/);
  });

  it("shows an empty state inside each card when nothing closed or nothing was due", () => {
    show(closures({
      closed_by_month: [{ month: "2026-08", closed: 0, filled: 0, cancelled: 0, other: 0, no_reason: 0 }],
      delivery_status: { on_time: 0, late: 0, overdue: 0, pending: 0, not_configured: 0 },
    }));
    expect(card("Cierres de vacantes").getByRole("heading", { name: "Sin cierres en el periodo" })).toBeInTheDocument();
    expect(card("Estado de entregas").getByRole("heading", { name: "Sin entregas en el periodo" })).toBeInTheDocument();
  });

  it("keeps the explanation behind «Cómo se calcula», with no sentence under the title", async () => {
    show();
    const heading = screen.getByRole("heading", { level: 2, name: "Cierres y entregas" });
    expect(heading.parentElement?.querySelector("p")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Cierres y entregas" }));
    expect(within(screen.getByRole("dialog")).getByText(/cerradas con motivo cubierta/)).toBeInTheDocument();
  });
});
