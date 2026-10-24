import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectionCards } from "./section-cards";
const data = { published_vacancies: 17, in_process: 26, pool_added_last_7_days: 9, positions: { covered: 3, required: 5 } };
const KPI_CARDS = [
  { label: "Vacantes publicadas", value: "17", primary: "Con publicación activa", context: "Visibles para tu cuenta" },
  { label: "Candidatos en proceso", value: "26", primary: "En etapas de progreso", context: "En tus vacantes publicadas" },
  { label: "Nuevos en la base", value: "9", primary: "Últimos 7 días", context: "Base de talento de tu empresa" },
  { label: "Posiciones cubiertas", value: "3/5", primary: "Cubiertas sobre requeridas", context: "En tus vacantes publicadas" },
];
function kpiCards() { return Array.from(document.querySelectorAll<HTMLElement>("[data-pf-kpi-cards] [data-slot='card']")); }
afterEach(cleanup);
describe("company dashboard KPI cards — approved composition, real metrics", () => {
  it("keeps the preserved grid and four card headers/actions/footers", () => {
    render(<SectionCards data={data} />);
    expect(kpiCards()).toHaveLength(4);
    for (const card of kpiCards()) {
      for (const slot of ["card-header", "card-title", "card-description", "card-action", "card-footer"]) expect(card.querySelector(`[data-slot='${slot}']`)).not.toBeNull();
    }
  });
  it("renders the four real metrics with factual highlight and context lines", () => {
    render(<SectionCards data={data} />);
    KPI_CARDS.forEach((expected, index) => { for (const text of Object.values(expected)) expect(within(kpiCards()[index]).getByText(text)).toBeInTheDocument(); });
  });
  it("replaces fake trend deltas with decorative accent icon medallions", () => {
    render(<SectionCards data={data} />);
    for (const card of kpiCards()) {
      const tile = card.querySelector("[data-slot='card-action'] [data-pf-metric-icon]");
      expect(tile).toHaveClass("rounded-full", "bg-primary/10");
      expect(tile?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
    expect(document.querySelector('[class*="trending"]')).toBeNull();
    expect(screen.queryByText(/\+\d/)).toBeNull();
  });
  it("keeps the fourth primary footer marker and visualizes actual coverage", () => {
    render(<SectionCards data={data} />);
    const marked = document.querySelector("[data-pf-growth-footer]");
    expect(kpiCards()[3].contains(marked)).toBe(true);
    expect(marked).toHaveTextContent("Cubiertas sobre requeridas");
    expect(screen.getByRole("progressbar", { name: "Posiciones cubiertas" })).toHaveAttribute("aria-valuenow", "60");
  });
  it("handles zero required positions without inventing a percentage", () => {
    render(<SectionCards data={{ ...data, positions: { covered: 0, required: 0 } }} />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
