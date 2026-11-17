import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const flags = vi.hoisted(() => ({ detailPage: false }));
// The detail page is off until T10b; flipping it here checks the exact query each figure opens.
vi.mock("../drilldown", async importOriginal => {
  const actual = await importOriginal<typeof import("../drilldown")>();
  return { ...actual, drilldownHref: (...[target, filters, options]: Parameters<typeof actual.drilldownHref>) => actual.drilldownHref(target, filters, { ...options, enabled: flags.detailPage }) };
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
import type { OriginSection as OriginData } from "../model";
import type { SectionState } from "../use-section";
import { origin } from "../test-fixtures";
import { OriginSection } from "./origin-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: OriginData): SectionState<OriginData> => ({ status: "ready", data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: OriginData = origin()) => render(<OriginSection state={ready(data)} filters={{ recruiter_id: "10000000-0000-4000-8000-000000000001" }} period={period} />);
/** The figure's own query; `back` (the board it returns to) is checked on its own. */
const query = (link: HTMLElement) => { const params = new URL(link.getAttribute("href")!, "https://app.test").searchParams; params.delete("back"); return Object.fromEntries(params); };

beforeEach(() => { flags.detailPage = false; });
afterEach(cleanup);

describe("Origen de las postulaciones (artboard 07)", () => {
  it("has a professional title, no explanation under it, and the definitions behind «Cómo se calcula»", async () => {
    show();
    const section = screen.getByRole("region", { name: "Origen de las postulaciones" });
    expect(section.querySelector("h2 + p")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Origen de las postulaciones" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Sin distinguir");
  });

  it("states the period total and sorts the channels with count and share", () => {
    show();
    const card = screen.getByRole("heading", { level: 3, name: "Postulaciones por canal" }).closest('[data-slot="card"]') as HTMLElement;
    expect(card).toHaveTextContent("515 postulaciones en el periodo");
    expect(within(card).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Portal o sitio, sin distinguir300 · 58%", "Portal de vacantes120 · 23%", "Registro manual61 · 12%", "Sitio de carreras34 · 7%",
    ]);
  });

  it("draws only the top channel in the accent colour", () => {
    show();
    const bars = screen.getAllByTestId("origin-bar");
    expect(bars.map(bar => bar.dataset.tone)).toEqual(["accent", "muted", "muted", "muted"]);
    expect(bars.slice(0, 2).map(bar => bar.style.width)).toEqual(["100%", "40%"]);
  });

  it("keeps a real 0 as 0, never a link, and shows the empty card when nothing arrived", () => {
    flags.detailPage = true;
    show(origin({ by_channel: { portal: 5, careers_site: 0, manual: 0, unknown: 0 } }));
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("0 · 0%");
    expect(screen.queryByRole("link", { name: /Sitio de carreras/ })).not.toBeInTheDocument();
    cleanup();
    show(origin({ by_channel: { portal: 0, careers_site: 0, manual: 0, unknown: 0 } }));
    expect(screen.getByText("Sin postulaciones en este periodo")).toBeInTheDocument();
  });

  it("opens the applications of each channel per contract §4.6", () => {
    flags.detailPage = true;
    show();
    const filters = { ...period, recruiter_id: "10000000-0000-4000-8000-000000000001" };
    expect(query(screen.getByRole("link", { name: "Ver las 515 postulaciones" }))).toEqual({ kind: "applications", ...filters });
    expect(query(screen.getByRole("link", { name: "Ver las 120 postulaciones de Portal de vacantes, 23%" }))).toEqual({ kind: "applications", channel: "portal", ...filters });
    expect(query(screen.getByRole("link", { name: "Ver las 34 postulaciones de Sitio de carreras, 7%" }))).toMatchObject({ channel: "careers_site" });
    expect(query(screen.getByRole("link", { name: "Ver las 61 postulaciones de Registro manual, 12%" }))).toMatchObject({ channel: "manual" });
    expect(query(screen.getByRole("link", { name: "Ver las 300 postulaciones de Portal o sitio, sin distinguir, 58%" }))).toMatchObject({ channel: "unknown" });
  });
});
