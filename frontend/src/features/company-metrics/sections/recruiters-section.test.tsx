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
/** The figure's own query; `back` (the board it returns to) is checked on its own. */
const query = (link: HTMLElement) => { const params = new URL(link.getAttribute("href")!, "https://app.test").searchParams; params.delete("back"); return Object.fromEntries(params); };
const back = (link: HTMLElement) => new URL(link.getAttribute("href")!, "https://app.test").searchParams.get("back");

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
    expect(andreaRow.slice(1, 5)).toEqual(["9", "86% a tiempo6 de 7", "6", "83% · 5 de 6"]);
    expect(carlosRow.slice(1, 5)).toEqual(["6", "40% a tiempo2 de 5", "3", "50% · 2 de 4"]);
    expect(fernandaRow.slice(1, 5)).toEqual(["2", "Sin datos suficientes", "0", "Sin datos suficientes"]);
  });

  it("keeps the heading on one line on a narrow screen: its actions wrap below it instead of squeezing it (rule 14)", () => {
    show();
    const heading = screen.getByRole("heading", { level: 2, name: "Desempeño por reclutador" });
    expect(heading.parentElement).toHaveClass("flex-wrap");
    expect(screen.getByRole("button", { name: "Ver tabla completa" }).parentElement).toHaveClass("ml-auto");
  });

  it("puts «Cómo se calcula» first in the header actions, as the other sections", () => {
    show();
    const heading = screen.getByRole("heading", { level: 2, name: "Desempeño por reclutador" });
    const actions = heading.nextElementSibling as HTMLElement;
    expect(within(actions).getAllByRole("button").map(button => button.textContent)).toEqual(["Cómo se calcula", "Ver tabla completa"]);
  });

  it("gives the name priority on a narrow row: it wraps, and «Sin datos suficientes» wraps in a narrow column (rule 14)", () => {
    show();
    const fernandaRow = rows()[3];
    const [name, , onTime] = within(fernandaRow).getAllByRole("cell");
    const nameLine = within(name).getByRole("link", { name: "Fernanda Ortiz" }).parentElement!;
    expect(nameLine).toHaveClass("max-md:break-words");
    expect(nameLine).not.toHaveClass("truncate");
    expect(within(onTime).getByText("Sin datos suficientes")).toHaveClass("max-md:max-w-20", "max-md:block");
  });

  it("lets the name actually wrap at 390 px: the cells inherit `nowrap` from TableCell, so the name cell and the no-sample label reset it, and the figure column keeps its content width (rule 14)", () => {
    show();
    const row = rows()[3];
    const [name, , onTime, , , chevron] = within(row).getAllByRole("cell");
    // Without the reset the name stays on one line and runs under the figure beside it.
    expect(name).toHaveClass("max-md:min-w-0", "max-md:whitespace-normal");
    expect(within(name).getByRole("link", { name: "Fernanda Ortiz" }).parentElement).toHaveClass("min-w-0", "max-md:break-words");
    expect(within(onTime).getByText("Sin datos suficientes")).toHaveClass("max-md:whitespace-normal");
    // Name column takes the leftover space and may shrink; the figure and chevron columns are content-sized.
    expect(row).toHaveClass("max-md:grid-cols-[minmax(0,1fr)_auto_40px]");
    expect(onTime).not.toHaveClass("max-md:whitespace-normal");
    expect(chevron).toHaveClass("max-md:col-start-3");
  });

  it("keeps «N% a tiempo» on one line on a narrow row, so a long name wraps instead of the figure (rule 14)", () => {
    show();
    const [, , onTime] = within(rows()[0]).getAllByRole("cell");
    expect(onTime).not.toHaveClass("max-md:whitespace-normal");
    expect(onTime.firstElementChild).toHaveClass("inline-flex");
    expect(within(onTime).getByText("a tiempo")).toBeInTheDocument();
  });

  it("turns each row into a stacked list row on a narrow screen, every figure named by its column (rule 14)", () => {
    show();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("max-md:block");
    const [name, assigned, onTime, placements, conversion, detail] = within(rows()[1]).getAllByRole("cell");
    expect([assigned, onTime, placements, conversion].map(cell => cell.getAttribute("data-label"))).toEqual(["Vacantes asignadas", "Entregas a tiempo", "Placements", "Conversión"]);
    expect(name).not.toHaveAttribute("data-label");
    expect(detail).not.toHaveAttribute("data-label");
    expect(within(rows()[1]).getAllByRole("cell").map(cell => cell.textContent).slice(1, 5)).toEqual(["11", "75% a tiempo6 de 8", "9", "75% · 6 de 8"]);
  });

  it("keeps a narrow row to the name, the on-time rate and the chevron (rule 14), with no empty divider above the first row", () => {
    flags.detailPage = true;
    show();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("max-md:[&_tbody_tr:first-child]:border-t-0");
    const [name, assigned, onTime, placements, conversion, detail] = within(rows()[1]).getAllByRole("cell");
    for (const cell of [assigned, placements, conversion]) expect(cell).toHaveClass("max-md:hidden");
    for (const cell of [name, onTime, detail]) expect(cell).not.toHaveClass("max-md:hidden");
    // The one figure says what it is on its own line, and its «N de M» waits for the wide table.
    expect(within(onTime).getByText("a tiempo")).toHaveClass("md:hidden");
    expect(within(onTime).getByRole("link", { name: "6 de 8: ver las 8 entregas con fecha de Mariana Torres" })).toHaveClass("max-md:hidden");
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
    // «Volver» returns to this board, without a «Reclutador» chip the board never had.
    expect(back(screen.getByRole("link", { name: "Ver las 11 vacantes asignadas a Mariana Torres" }))).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31");
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
