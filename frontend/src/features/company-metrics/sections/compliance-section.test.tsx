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
import type { ComplianceSection as ComplianceData } from "../model";
import { compliance } from "../test-fixtures";
import { ComplianceSection } from "./compliance-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: ComplianceData) => ({ status: "ready" as const, data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: ComplianceData = compliance()) => render(<ComplianceSection state={ready(data)} filters={{}} period={period} />);
const card = (name: string) => within(screen.getByRole("article", { name }));
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);
const row = (label: string) => within(card("Entregas con fecha cumplida").getByText(label).closest("li")!);
const noSample = { value: null, numerator: 0, denominator: 0 };

beforeEach(() => {
  drill.enabled = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Cumplimiento de entregas (artboard 07)", () => {
  it("shows the period on-time rate from the monthly numerators and denominators", () => {
    show();
    const due = card("Entregas con fecha cumplida");
    expect(due.getByText("67%")).toBeInTheDocument();
    expect(due.getByText("20 de 30")).toBeInTheDocument();
    expect(due.getByText(/entregas en el periodo/)).toHaveTextContent("30 entregas en el periodo");
  });

  it("splits late deliveries by business days late", () => {
    show();
    expect(card("Entregas con fecha cumplida").getByText("Entregas tarde por días de retraso")).toBeInTheDocument();
    expect(row("Hasta 2 días hábiles").getByText("3")).toBeInTheDocument();
    expect(row("3 a 5 días hábiles").getByText("2")).toBeInTheDocument();
    expect(row("Más de 5 días hábiles").getByText("2")).toBeInTheDocument();
  });

  it("draws the monthly on-time line", () => {
    show();
    expect(card("A tiempo por mes").getByRole("img", { name: /Porcentaje de entregas a tiempo por mes/ })).toBeInTheDocument();
  });

  it("keeps every figure as plain text while the detail page is off", () => {
    show();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("opens the rate, each bucket and each month per contract §4.3", () => {
    drill.enabled = true;
    show();
    expect(query(screen.getByRole("link", { name: "Ver las 30 entregas con fecha cumplida, 67% a tiempo" })))
      .toEqual({ kind: "deliveries", result: "on_time,late,overdue", ...period });
    expect(query(row("Hasta 2 días hábiles").getByRole("link", { name: "Ver las 3 entregas con hasta 2 días hábiles de retraso" })))
      .toEqual({ kind: "deliveries", result: "late", late_bucket: "up_to_2", ...period });
    expect(query(row("3 a 5 días hábiles").getByRole("link", { name: "Ver las 2 entregas con 3 a 5 días hábiles de retraso" })))
      .toEqual({ kind: "deliveries", result: "late", late_bucket: "from_3_to_5", ...period });
    expect(query(row("Más de 5 días hábiles").getByRole("link", { name: "Ver las 2 entregas con más de 5 días hábiles de retraso" })))
      .toEqual({ kind: "deliveries", result: "late", late_bucket: "over_5", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 10 entregas con fecha cumplida de septiembre de 2026, 70% a tiempo" })))
      .toEqual({ kind: "deliveries", result: "on_time,late,overdue", commitment_month: "2026-09", ...period });
  });

  it("never links a 0", () => {
    drill.enabled = true;
    show(compliance({ late_buckets: { up_to_2: 3, from_3_to_5: 0, over_5: 2 } }));
    expect(row("3 a 5 días hábiles").getByText("0")).toBeInTheDocument();
    expect(row("3 a 5 días hábiles").queryAllByRole("link")).toHaveLength(0);
  });

  it("says «Sin datos suficientes» without due deliveries and shows the chart's empty state", () => {
    show(compliance({
      late_buckets: { up_to_2: 0, from_3_to_5: 0, over_5: 0 },
      on_time_by_month: [{ month: "2026-08", rate: noSample }, { month: "2026-09", rate: noSample }],
    }));
    expect(card("Entregas con fecha cumplida").getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(card("A tiempo por mes").getByRole("heading", { name: "Sin entregas con fecha cumplida" })).toBeInTheDocument();
  });

  it("keeps the explanation behind «Cómo se calcula», with no sentence under the title", async () => {
    show();
    const heading = screen.getByRole("heading", { level: 2, name: "Cumplimiento de entregas" });
    expect(heading.parentElement?.querySelector("p")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Cumplimiento de entregas" }));
    expect(within(screen.getByRole("dialog")).getByText(/Pendientes y sin meta no cuentan/)).toBeInTheDocument();
  });
});
