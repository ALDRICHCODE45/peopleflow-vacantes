import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { drilldownHref } from "../drilldown";
import type { ColumnId } from "../recruiter-view";
import type { SortKey } from "../sorting";
import { COLUMNS } from "../recruiter-columns";
import { RecruiterTable, SORT_BUTTON_CHROME, tableMinWidth } from "../recruiter-table";
import { COLUMN_IDS } from "../recruiter-view";
import { DEFAULT_SORT, type RecruiterSort } from "../sorting";
import { andrea, andreaId, card, carlos, fernanda } from "../test-fixtures";

const period = { from: "2026-08-01", to: "2026-10-31" };
const href = (person: { user_id: string }) => `/empresa/metricas/reclutadores/${person.user_id}?origin=table`;
const drill = (target: Parameters<typeof drilldownHref>[0], count: number) => drilldownHref(target, period, { count, enabled: true, back: "/empresa/metricas/reclutadores" });
const show = ({ items = [card(), carlos(), andrea(), fernanda()], sort = DEFAULT_SORT, hidden = [] as ColumnId[], onSort = vi.fn() }: { items?: ReturnType<typeof card>[]; sort?: RecruiterSort; hidden?: ColumnId[]; onSort?: (key: SortKey) => void } = {}) => {
  render(<RecruiterTable items={items} sort={sort} hidden={hidden} onSort={onSort} href={href} drill={drill} />);
  return onSort;
};
const table = () => screen.getByRole("table");
const phone = () => screen.getByRole("list", { name: "Reclutadores" });
const rowOf = (name: string) => within(table()).getByRole("row", { name: new RegExp(name) });

afterEach(() => { cleanup(); push.mockReset(); });

describe("full recruiter table at desktop width (S2)", () => {
  it("groups the eight columns as Carga de trabajo · Entrega de candidatos · Contratación, after the person", () => {
    show();
    const groups = within(table()).getAllByRole("columnheader").filter(header => header.getAttribute("scope") === "colgroup");
    expect(groups.map(header => [header.textContent, header.getAttribute("colspan")])).toEqual([["Carga de trabajo", "3"], ["Entrega de candidatos", "3"], ["Contratación", "2"]]);
    const names = within(table()).getAllByRole("columnheader").filter(header => header.getAttribute("scope") === "col").map(header => header.textContent);
    expect(names.filter(name => name !== "Ver ficha")).toEqual(["Reclutador", "Asignadas", "Reasignaciones", "Días en tramos", "Entregas a tiempo", "Mediana a la meta", "Entregados", "Placements", "Conversión"]);
    expect(names).toContain("Ver ficha");
  });

  it("keeps the first column and both header rows sticky inside one scroll region, and lets the cells wrap", () => {
    show();
    const region = screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(table());
    const headers = within(table()).getAllByRole("columnheader");
    expect(headers.find(header => header.textContent === "Reclutador")).toHaveClass("sticky", "left-0");
    expect(headers.find(header => header.textContent === "Carga de trabajo")).toHaveClass("sticky", "top-0");
    expect(within(rowOf("Mariana")).getAllByRole("rowheader")[0]).toHaveClass("sticky", "left-0");
    // Extends the audit-table exception (design/system.md): no cell is cut with an ellipsis.
    expect(within(table()).getAllByRole("cell")[0].className).not.toMatch(/truncate|whitespace-nowrap/);
  });

  // 1440 − 288 sidebar − 2 × 12 inset margin − 2 × 24 page padding = 1092 px: the card's scroll area with the app sidebar open (collapsed it only gets wider).
  it("fits the scroll area at 1440 with the sidebar open: first column, eight figures and the chevron add up to at most 1092 px", () => {
    expect(tableMinWidth(COLUMN_IDS)).toBeLessThanOrEqual(1092);
    show();
    expect(table().style.minWidth).toBe(`${tableMinWidth(COLUMN_IDS)}px`);
    expect(tableMinWidth(COLUMN_IDS.filter(id => id !== "median"))).toBeLessThan(tableMinWidth(COLUMN_IDS));
  });

  it("wraps headers on spaces only: no hyphenation, and every column is wide enough for its longest header word", () => {
    show();
    for (const id of COLUMN_IDS) {
      const longest = Math.max(...COLUMNS[id].label.split(" ").map(word => word.length));
      // Inter 14px/500 measures 7.8 px per character at most for these words; the button adds its padding, gap and the sort icon.
      expect(Math.ceil(longest * 7.8) + SORT_BUTTON_CHROME, COLUMNS[id].label).toBeLessThanOrEqual(COLUMNS[id].width);
    }
    for (const button of within(table()).getAllByRole("button")) {
      expect(button.className).not.toMatch(/hyphens-auto/);
      expect(button).toHaveClass("hyphens-none");
    }
  });

  it("shows «Conversión» as a bold percentage with «N de M», no bar (as the Métricas card), both opening their records", () => {
    show();
    const mariana = within(rowOf("Mariana"));
    const percent = mariana.getByRole("link", { name: /^75% de conversión: ver las 6 vacantes cerradas con placement/ });
    const count = mariana.getByRole("link", { name: /^6 de 8: ver las 8 vacantes cerradas/ });
    expect(percent).toHaveClass("font-semibold");
    expect(percent.closest("td")).toBe(count.closest("td"));
    expect(percent.closest("td")).toHaveTextContent("75% 6 de 8");
    expect(percent.closest("td")!.querySelector("[aria-hidden=true]")).toBeNull();
    // «Entregas a tiempo» keeps its bar.
    expect(within(rowOf("Mariana")).getByRole("link", { name: /^75% a tiempo/ }).closest("td")!.querySelector("[aria-hidden=true]")).not.toBeNull();
  });

  it("names each person, their role count and a neutral «Ex miembro» badge, and links to the detail", () => {
    show();
    const mariana = within(rowOf("Mariana"));
    expect(mariana.getByRole("link", { name: "Mariana Torres" })).toHaveAttribute("href", href(card()));
    expect(mariana.getByText("8 como responsable")).toBeInTheDocument();
    expect(mariana.getByRole("link", { name: "Ver ficha de Mariana Torres" })).toHaveAttribute("href", href(card()));
    expect(within(rowOf("Carlos")).getByText("Ex miembro")).toBeInTheDocument();
    expect(within(rowOf("Carlos")).queryByText(/como responsable/)).not.toBeInTheDocument();
  });

  it("shows «Entregas a tiempo» as percentage and «N de M», with both figures opening their records (S3)", () => {
    show();
    const mariana = within(rowOf("Mariana"));
    const percent = mariana.getByRole("link", { name: "75% a tiempo: ver las 6 entregas a tiempo de Mariana Torres" });
    expect(percent).toHaveTextContent("75%");
    const count = mariana.getByRole("link", { name: "6 de 8: ver las 8 entregas con fecha de Mariana Torres" });
    expect(count).toHaveTextContent("6 de 8");
    expect(percent.closest("td")).toBe(count.closest("td"));
    expect(percent.closest("td")).toHaveTextContent("1 tarde · 1 vencida");
    expect(new URL(percent.getAttribute("href")!, "https://app.test").searchParams.get("back")).toBe("/empresa/metricas/reclutadores");
  });

  it("keeps «Sin datos suficientes» where nothing was judged, and a 0 is plain text, not a link", () => {
    show({ items: [fernanda()] });
    const row = within(rowOf("Fernanda"));
    expect(row.getByText("Ninguna vencía en el periodo").closest("td")).toHaveTextContent("Sin datos suficientes");
    expect(row.getAllByText("Sin datos suficientes")).toHaveLength(3);
    expect(row.getByText("0 de 0")).toBeInTheDocument();
    expect(row.getByText("Sin placements")).toBeInTheDocument();
    expect(row.queryByRole("link", { name: /placement/ })).toBeNull();
    expect(row.getByRole("link", { name: "Ver las 2 vacantes asignadas a Fernanda Ortiz" })).toBeInTheDocument();
  });

  it("writes the placement credits and what did not hold under the total", () => {
    show();
    const carlosRow = within(rowOf("Carlos"));
    expect(carlosRow.getByText("2 dir. · 1 part.")).toBeInTheDocument();
    expect(carlosRow.getByText("de ellos 1 no se sostuvo")).toBeInTheDocument();
    expect(carlosRow.getByRole("link", { name: "Ver los 3 placements de Carlos Mendoza Ruiz" })).toBeInTheDocument();
  });

  it("drops a column, and its whole group when every column of it is hidden", () => {
    show({ hidden: ["median", "reassignments", "assigned", "business_days"] });
    const groups = within(table()).getAllByRole("columnheader").filter(header => header.getAttribute("scope") === "colgroup");
    expect(groups.map(header => [header.textContent, header.getAttribute("colspan")])).toEqual([["Entrega de candidatos", "2"], ["Contratación", "2"]]);
    expect(within(table()).queryByRole("columnheader", { name: /Mediana/ })).toBeNull();
    expect(within(table()).getByRole("columnheader", { name: /Placements/ })).toBeInTheDocument();
  });

  it("sorts from the header and marks the current order with aria-sort", async () => {
    const onSort = show({ sort: { key: "on_time", direction: "descending" } });
    expect(within(table()).getByRole("columnheader", { name: /Entregas a tiempo/ })).toHaveAttribute("aria-sort", "descending");
    expect(within(table()).getByRole("columnheader", { name: /Conversión/ })).not.toHaveAttribute("aria-sort");
    await userEvent.click(within(table()).getByRole("button", { name: /Conversión/ }));
    expect(onSort).toHaveBeenCalledWith("conversion");
    await userEvent.click(within(table()).getByRole("button", { name: /Reclutador/ }));
    expect(onSort).toHaveBeenLastCalledWith("name");
  });

  it("opens the recruiter when the row is clicked outside its own links", async () => {
    show();
    await userEvent.click(within(rowOf("Mariana")).getAllByRole("cell")[3]);
    expect(push).toHaveBeenCalledWith(href(card()));
    push.mockReset();
    await userEvent.click(within(rowOf("Mariana")).getByRole("link", { name: "Mariana Torres" }));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("one card per recruiter on a phone (artboard 390 px)", () => {
  it("lists each person with the name, the chevron and a group per column group", () => {
    show();
    const cards = within(phone()).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    const mariana = within(cards.find(item => within(item).queryByRole("link", { name: "Mariana Torres" }))!);
    expect(mariana.getByRole("link", { name: "Ver ficha de Mariana Torres" })).toHaveAttribute("href", href(card()));
    expect(mariana.getAllByRole("group").map(group => group.getAttribute("aria-label"))).toEqual(["Carga de trabajo", "Entrega de candidatos", "Contratación"]);
    const terms = mariana.getAllByRole("term").map(term => term.textContent);
    expect(terms).toEqual(["Asignadas", "Reasignaciones", "Días en tramos", "Entregas a tiempo", "Mediana a la meta", "Entregados", "Placements", "Conversión"]);
    const value = (term: string) => mariana.getAllByRole("term").find(node => node.textContent === term)!.nextElementSibling!;
    expect(value("Entregas a tiempo")).toHaveTextContent("75% 6 de 8");
    expect(value("Conversión")).toHaveTextContent("75% 6 de 8");
    expect(value("Días en tramos")).toHaveTextContent("201hábiles");
  });

  it("hides the chosen columns and says so when none is left", () => {
    show({ hidden: ["median", "delivered"] });
    expect(within(phone()).getAllByRole("listitem")[0]).not.toHaveTextContent("Mediana a la meta");
    cleanup();
    show({ hidden: ["assigned", "reassignments", "business_days", "on_time", "median", "delivered", "placements", "conversion"] });
    expect(within(phone()).getAllByText("Todas las columnas están ocultas. Elige cuáles ver en «Columnas».")).toHaveLength(4);
  });

  it("links the figures to their records like the table, from the same cell", () => {
    show({ items: [andrea()] });
    expect(within(phone()).getByRole("link", { name: "Ver las 9 vacantes asignadas a Andrea Villalobos" })).toHaveAttribute("href", expect.stringContaining(`recruiter_id=${andreaId}`));
  });
});
