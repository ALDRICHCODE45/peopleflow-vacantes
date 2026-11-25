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
import { FIRST_WIDTH, RecruiterTable, SORT_BUTTON_CHROME, tableMinWidth } from "../recruiter-table";
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

  // The width the table gets at 1440 × 900 with the app sidebar open and CLASSIC scrollbars (the user's Firefox on Linux):
  //   1440 viewport − 288 sidebar (18 rem) − 12 right inset margin − 2 × 24 page padding = 1092 px of card, and
  //   1092 − 15 px page scrollbar = 1077 px. The table region has no vertical scroll of its own (it would take another 15 px),
  //   so 1077 px is all there is. The table has to be at most 1050 px, which leaves about 27 px of slack for rounding and borders.
  it("fits the scroll area at 1440 with the sidebar open and a classic page scrollbar: at most 1050 px for 1077 px", () => {
    const AREA = 1092 - 15;
    expect(tableMinWidth(COLUMN_IDS)).toBeLessThanOrEqual(1050);
    expect(AREA - tableMinWidth(COLUMN_IDS)).toBeGreaterThanOrEqual(25);
    show();
    expect(table().style.minWidth).toBe(`${tableMinWidth(COLUMN_IDS)}px`);
    const cols = Array.from(table().querySelectorAll("col")).map(col => parseInt((col as HTMLElement).style.width, 10));
    expect(cols.reduce((sum, width) => sum + width, 0)).toBe(tableMinWidth(COLUMN_IDS));
    expect(tableMinWidth(COLUMN_IDS.filter(id => id !== "median"))).toBeLessThan(tableMinWidth(COLUMN_IDS));
  });

  it("lets the page scroll when the table fits (no region scrollbar, header sticky against the page) and keeps the region scroll only below that width", () => {
    show();
    const region = screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" });
    const fit = `@min-[${tableMinWidth(COLUMN_IDS)}px]`;
    // From the width the table needs, the region neither scrolls nor caps its height: `overflow: visible` keeps `position: sticky` tied to the page.
    expect(region).toHaveClass(`${fit}:overflow-visible`, `${fit}:max-h-none`);
    // Below it the region scrolls sideways (and holds the sticky header) as before.
    expect(region).toHaveClass("overflow-auto");
    // The card clips its corners with `overflow: clip`, which, unlike `hidden`, does not become the sticky container.
    const card = region.parentElement!;
    expect(card).toHaveClass("overflow-clip", "@container");
    expect(card.className).not.toMatch(/overflow-hidden/);
  });

  it("keeps the sticky columns off the cell content: the chevron column does not stick over «Conversión», the person column is opaque and as wide as its colgroup", () => {
    show();
    const chevron = within(rowOf("Mariana")).getByRole("link", { name: "Ver ficha de Mariana Torres" }).closest("td")!;
    expect(chevron.className).not.toMatch(/sticky|right-0/);
    const head = within(table()).getByRole("columnheader", { name: "Ver ficha" });
    expect(head.className).not.toMatch(/right-0/);
    const first = within(rowOf("Mariana")).getAllByRole("rowheader")[0];
    expect(first).toHaveClass("sticky", "left-0", "bg-card");
    expect(table().querySelector("col")).toHaveStyle({ width: `${FIRST_WIDTH}px` });
  });

  // Inter 500 at 12 px, measured in Chromium with the font the app ships (`.next/static/media`, latin subset) at 120 px and divided by 10,
  // so hinting does not round them. Hinted Chromium text runs up to 4.7 % wider, so the test inflates by 5 %.
  const WIDTH_12: Record<string, number> = {
    Asignadas: 60.6, Reasignaciones: 91.3, "Días": 25.2, en: 14.5, tramos: 40.1, Entregas: 51.3, a: 6.9, tiempo: 39.8, Mediana: 49.8, la: 10, meta: 29,
    Entregados: 66.1, Placements: 67.6, "Conversión": 65.9,
  };
  const SPACE_12 = 3.2;
  const SAFETY = 1.05;
  const SLACK = 2;
  const wordWidth = (word: string) => {
    const width = WIDTH_12[word];
    if (width === undefined) throw new Error(`measure «${word}» (12 px / 500) and add it to WIDTH_12`);
    return width * SAFETY;
  };
  /** Greedy line breaking on spaces only, like the header button (`whitespace-normal`, `hyphens-none`); a line has to fit with `SLACK` px to spare. */
  const wrap = (label: string, available: number) => {
    const lines: string[][] = [[]];
    for (const word of label.split(" ")) {
      const line = lines[lines.length - 1];
      const width = [...line, word].reduce((sum, item, index) => sum + wordWidth(item) + (index ? SPACE_12 * SAFETY : 0), 0);
      if (line.length === 0 || width + SLACK <= available) line.push(word); else lines.push([word]);
    }
    return lines;
  };

  it("wraps headers on spaces only: every word inside its column with at least 2 px to spare, in at most 2 lines (12 px / 500, sidebar open)", () => {
    show();
    for (const id of COLUMN_IDS) {
      const available = COLUMNS[id].width - SORT_BUTTON_CHROME;
      const lines = wrap(COLUMNS[id].label, available);
      expect(lines.length, `${COLUMNS[id].label} in ${COLUMNS[id].width} px`).toBeLessThanOrEqual(2);
      for (const line of lines) {
        const width = line.reduce((sum, word, index) => sum + wordWidth(word) + (index ? SPACE_12 * SAFETY : 0), 0);
        expect(width + SLACK, `${line.join(" ")} in ${available} px`).toBeLessThanOrEqual(available);
      }
    }
    for (const button of within(table()).getAllByRole("button")) {
      expect(button.className).not.toMatch(/hyphens-auto/);
      expect(button).toHaveClass("hyphens-none");
    }
  });

  it("sets the column headers at the table-header size of the recruiter table, 12 px medium", () => {
    show();
    for (const id of COLUMN_IDS) {
      const button = within(table()).getByRole("button", { name: new RegExp(COLUMNS[id].label) });
      expect(button).toHaveClass("text-xs");
      expect(button.className).not.toMatch(/(^|\s)text-(sm|base)(\s|$)/);
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
