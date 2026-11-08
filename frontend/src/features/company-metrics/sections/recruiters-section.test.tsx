import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const flags = vi.hoisted(() => ({ detailPage: false }));
const table = vi.hoisted(() => ({ props: null as null | { items: { user_id: string }[]; href: (card: { user_id: string }) => string } }));
// The detail page is off until T10b; flipping it here checks the exact query each figure opens.
vi.mock("../drilldown", async importOriginal => {
  const actual = await importOriginal<typeof import("../drilldown")>();
  return { ...actual, drilldownHref: (...[target, filters, options]: Parameters<typeof actual.drilldownHref>) => actual.drilldownHref(target, filters, { ...options, enabled: flags.detailPage }) };
});
// The full table is reused as is; this boundary only records what the section hands it.
vi.mock("../recruiter-table", () => ({
  RecruiterTable: (props: NonNullable<typeof table.props>) => { table.props = props; return <p>{`Tabla completa con ${props.items.length} personas`}</p>; },
}));
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
// jsdom has no matchMedia for the Base UI dialog; the sheet opens inline with its title.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => open ? <div role="dialog" aria-label="Desempeño por reclutador">{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));
import type { RecruiterCard } from "../model";
import type { SectionState } from "../use-section";
import { andrea, card, carlos, fernanda, fernandaId, marianaId, recruiterPage } from "../test-fixtures";
import { RecruitersSection } from "./recruiters-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: RecruiterCard[]): SectionState<RecruiterCard[]> => ({ status: "ready", data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (items: RecruiterCard[] = recruiterPage().items) => render(<RecruitersSection state={ready(items)} filters={{}} period={period} />);
const rows = () => screen.getAllByRole("row").slice(1);
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);

beforeEach(() => { flags.detailPage = false; table.props = null; });
afterEach(cleanup);

describe("Desempeño por reclutador (artboard 07)", () => {
  it("has a professional title, no explanation under it, and the definitions behind «Cómo se calcula»", async () => {
    show();
    const section = screen.getByRole("region", { name: "Desempeño por reclutador" });
    expect(section.querySelector("h2 + p")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Desempeño por reclutador" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Conversión");
  });

  it("compares in at most six columns, sorted by on-time rate with rows without sample last", () => {
    show();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Reclutador", "Vacantes asignadas", "Entregas a tiempo", "Placements", "Conversión", "Detalle"]);
    expect(rows().map(row => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "AVAndrea Villalobos", "MTMariana Torres", "CMCarlos Mendoza Ruiz (Ex miembro)", "FOFernanda Ortiz",
    ]);
  });

  it("reads each figure with its «N de M», and a missing sample as «Sin datos suficientes»", () => {
    show();
    const [andreaRow, , carlosRow, fernandaRow] = rows().map(row => within(row).getAllByRole("cell").map(cell => cell.textContent));
    expect(andreaRow.slice(1, 5)).toEqual(["9", "86%6 de 7", "6", "83% · 5 de 6"]);
    expect(carlosRow.slice(1, 5)).toEqual(["6", "40%2 de 5", "3", "50% · 2 de 4"]);
    expect(fernandaRow.slice(1, 5)).toEqual(["2", "Sin datos suficientes", "0", "Sin datos suficientes"]);
  });

  it("names a recruiter without a name", () => {
    show([card({ name: null })]);
    expect(within(rows()[0]).getAllByRole("cell")[0]).toHaveTextContent("Persona sin nombre");
  });

  it("links each person to the recruiter detail with the period", () => {
    show();
    const href = `/empresa/metricas/reclutadores/${marianaId}?from=2026-08-01&to=2026-10-31`;
    expect(screen.getByRole("link", { name: "Ver detalle de Mariana Torres" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "Mariana Torres" })).toHaveAttribute("href", href);
  });

  it("shows the first five and opens the full table in a sheet", async () => {
    const many = [andrea(), carlos(), fernanda(), card(), card({ user_id: "u5", name: "Rosa Díaz" }), card({ user_id: "u6", name: "Iván Soto" })];
    show(many);
    expect(rows()).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Ver tabla completa" }));
    expect(screen.getByText("Tabla completa con 6 personas")).toBeInTheDocument();
    expect(table.props?.href({ user_id: fernandaId })).toBe(`/empresa/metricas/reclutadores/${fernandaId}?from=2026-08-01&to=2026-10-31`);
  });

  it("shows the empty card when nobody had activity", () => {
    show([]);
    expect(screen.getByText("Aún no hay reclutadores con actividad en este periodo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver tabla completa" })).not.toBeInTheDocument();
  });

  it("opens every figure's records per contract §4.6, and a 0 is never a link", () => {
    flags.detailPage = true;
    show();
    const open = (name: string) => query(screen.getByRole("link", { name }));
    expect(open("Ver las 11 vacantes asignadas a Mariana Torres")).toEqual({ kind: "vacancies", scope: "assigned", recruiter_id: marianaId, ...period });
    expect(open("75% a tiempo: ver las 6 entregas a tiempo de Mariana Torres")).toEqual({ kind: "deliveries", attributed_to: marianaId, result: "on_time", ...period });
    expect(open("6 de 8: ver las 8 entregas con fecha de Mariana Torres")).toEqual({ kind: "deliveries", attributed_to: marianaId, result: "on_time,late,overdue", ...period });
    expect(open("Ver los 9 placements de Mariana Torres")).toEqual({ kind: "placements", recipient: marianaId, ...period });
    expect(open("75% de conversión: ver las 6 vacantes cerradas con placement de Mariana Torres")).toEqual({ kind: "vacancies", scope: "closed_assigned", recruiter_id: marianaId, credited_to: marianaId, ...period });
    expect(open("6 de 8: ver las 8 vacantes cerradas de Mariana Torres")).toEqual({ kind: "vacancies", scope: "closed_assigned", recruiter_id: marianaId, ...period });
    const fernandaRow = rows()[3];
    expect(within(fernandaRow).getAllByRole("link").map(link => link.getAttribute("aria-label") ?? link.textContent)).toEqual([
      "Fernanda Ortiz", "Ver las 2 vacantes asignadas a Fernanda Ortiz", "Ver detalle de Fernanda Ortiz",
    ]);
  });
});
