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
import type { DelaysSection as DelaysData } from "../model";
import type { SectionState } from "../use-section";
import { delays, draftId } from "../test-fixtures";
import { DelaysSection } from "./delays-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: DelaysData): SectionState<DelaysData> => ({ status: "ready", data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: DelaysData = delays()) => render(<DelaysSection state={ready(data)} filters={{}} period={period} />);
const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest('[data-slot="card"]') as HTMLElement;
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);

beforeEach(() => { flags.detailPage = false; });
afterEach(cleanup);

describe("Retrasos y reasignaciones (artboard 07)", () => {
  it("has a professional title, no explanation under it, and the definitions behind «Cómo se calcula»", async () => {
    show();
    const section = screen.getByRole("region", { name: "Retrasos y reasignaciones" });
    expect(section.querySelector("h2 + p")).toBeNull();
    expect(within(section).queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Retrasos y reasignaciones" }));
    const help = screen.getByRole("dialog");
    expect(help).toHaveTextContent("Meta de cierre");
    expect(help).toHaveTextContent("días hábiles");
    expect(help).toHaveTextContent("Reasignaciones por motivo");
  });

  it("shows three cards side by side: closing target, overdue deliveries and reassignments", () => {
    show();
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Meta de cierre", "Entregas vencidas", "Reasignaciones por motivo"]);
  });

  it("reads the closing target of filled closes: the late ones big, every segment with its word and count", () => {
    show();
    const meta = card("Meta de cierre");
    expect(meta).toHaveTextContent("De 18 vacantes cerradas");
    expect(meta).toHaveTextContent("5cerraron después de su meta");
    expect(within(meta).getByRole("img", { name: "Meta de cierre: 9 a tiempo, 5 tarde, 4 sin meta" })).toBeInTheDocument();
    const keys = within(meta).getAllByRole("listitem").map(item => item.textContent);
    expect(keys).toEqual(["A tiempo9", "Tarde5", "Sin meta4"]);
  });

  it("lists the most overdue deliveries with requester, people, days overdue and progress", () => {
    show();
    const overdue = card("Entregas vencidas");
    expect(overdue).toHaveTextContent("3 sin enviar a la fecha");
    const rows = within(overdue).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ejecutivo de cuenta");
    expect(rows[0]).toHaveTextContent("Grupo Bimbo · Mariana Torres");
    expect(rows[0]).toHaveTextContent("Hace 13 días");
    expect(rows[0]).toHaveTextContent("Entregó 2 de 5");
    expect(rows[1]).toHaveTextContent("Vacante sin título");
    expect(rows[1]).toHaveTextContent("Hace 8 días");
    expect(rows[1]).toHaveTextContent("Entregó 0 de 3");
  });

  it("names a former member and a missing requester or name in the overdue rows", () => {
    show(delays({ overdue: { total: 1, top: [{ vacancy: { draft_id: draftId, title: "Analista" }, commitment_date: "2026-10-20", business_days_overdue: 1, delivered: 1, target: 2,
      requester: null, attributed_to: [{ user_id: "u1", name: null, former_member: false }, { user_id: "u2", name: "Carlos Mendoza", former_member: true }] }] } }));
    const row = within(card("Entregas vencidas")).getByRole("listitem");
    expect(row).toHaveTextContent("Sin solicitante · Persona sin nombre, Carlos Mendoza (Ex miembro)");
    expect(row).toHaveTextContent("Hace 1 día");
  });

  it("sorts the reassignment reasons, keeps zeros as plain 0 and labels each reason", () => {
    show();
    const reasons = card("Reasignaciones por motivo");
    expect(reasons).toHaveTextContent("6 en el periodo");
    expect(within(reasons).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Salida del reclutador3", "Carga de trabajo2", "Petición del cliente1", "Desempeño0", "Otro motivo0",
    ]);
    expect(within(reasons).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows each card's own empty state", () => {
    show(delays({ closing_target: { on_time: 0, late: 0, no_target: 0 }, overdue: { total: 0, top: [] },
      reassignments_by_reason: { workload: 0, recruiter_departure: 0, performance: 0, client_request: 0, other: 0 } }));
    expect(card("Meta de cierre")).toHaveTextContent("Sin vacantes cubiertas en este periodo");
    expect(card("Entregas vencidas")).toHaveTextContent("Todo al día");
    expect(card("Reasignaciones por motivo")).toHaveTextContent("Sin reasignaciones en este periodo");
  });

  it("opens every figure's records per contract §4.5, and a 0 is never a link", () => {
    flags.detailPage = true;
    show();
    const late = screen.getByRole("link", { name: "Ver las 5 vacantes que cerraron después de su meta" });
    expect(query(late)).toEqual({ kind: "vacancies", scope: "closed", close_reason: "filled", closing_target: "late", ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 18 vacantes cubiertas" }))).toEqual({ kind: "vacancies", scope: "closed", close_reason: "filled", ...period });
    // Each segment and its key open the same list.
    for (const [name, value] of [["Ver las 9 vacantes cubiertas a tiempo", "on_time"], ["Ver las 5 vacantes cubiertas tarde", "late"], ["Ver las 4 vacantes cubiertas sin meta", "no_target"]]) {
      const links = screen.getAllByRole("link", { name });
      expect(links).toHaveLength(2);
      for (const link of links) expect(query(link)).toEqual({ kind: "vacancies", scope: "closed", close_reason: "filled", closing_target: value, ...period });
    }
    const overdue = { kind: "deliveries", result: "overdue", sort: "business_days_overdue", order: "desc", ...period };
    // The caption figure and the footer link open the same list.
    const overdueLinks = screen.getAllByRole("link", { name: "Ver las 3 entregas vencidas" });
    expect(overdueLinks).toHaveLength(2);
    for (const link of overdueLinks) expect(query(link)).toEqual(overdue);
    expect(within(card("Meta de cierre")).getByRole("group", { name: "Meta de cierre: 9 a tiempo, 5 tarde, 4 sin meta" })).toBeInTheDocument();
    expect(query(screen.getByRole("link", { name: "Ver la entrega vencida de Ejecutivo de cuenta" }))).toEqual({ kind: "deliveries", result: "overdue", vacancy_id: draftId, ...period });
    expect(query(screen.getByRole("link", { name: "Ver las 3 reasignaciones por salida del reclutador" }))).toEqual({ kind: "reassignments", reason: "recruiter_departure", ...period });
    expect(query(screen.getByRole("link", { name: "Ver la 1 reasignación por petición del cliente" }))).toMatchObject({ reason: "client_request" });
    expect(query(screen.getByRole("link", { name: "Ver las 6 reasignaciones" }))).toEqual({ kind: "reassignments", ...period });
    expect(screen.queryByRole("link", { name: /desempeño/ })).not.toBeInTheDocument();
  });
});
