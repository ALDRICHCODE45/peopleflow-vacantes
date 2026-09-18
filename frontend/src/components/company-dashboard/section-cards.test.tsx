import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SectionCards } from "./section-cards";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/section-cards.tsx"),
  "utf8",
);

// The approved recruiting KPIs, in the approved order. Primary is the trend
// line that carries the growth marker on the fourth card; context is the
// secondary muted line below it.
const KPI_CARDS = [
  {
    label: "Vacantes activas",
    value: "12",
    trend: "+2",
    primary: "En alza este mes",
    context: "3 publicadas esta semana",
  },
  {
    label: "Candidatos nuevos",
    value: "42",
    trend: "+18",
    primary: "Buen ritmo de entrada",
    context: "Esperan tu primera revisión",
  },
  {
    label: "En revisión",
    value: "28",
    trend: "+5",
    primary: "Revisión al alza",
    context: "Avanzando en tu pipeline",
  },
  {
    label: "Contrataciones este mes",
    value: "3",
    trend: "+1",
    primary: "Sumando incorporaciones",
    context: "Tasa de cierre del 11%",
  },
] as const;

/** Returns the four KPI cards inside the marked region, in render order. */
function kpiCards(): HTMLElement[] {
  const wrapper = document.querySelector("[data-pf-kpi-cards]");
  expect(wrapper, "KPI region marker").not.toBeNull();
  return Array.from(
    wrapper!.querySelectorAll("[data-slot='card']"),
  ) as HTMLElement[];
}

afterEach(cleanup);

describe("company dashboard KPI cards", () => {
  it("keeps the preserved KPI region marker on the grid element", () => {
    render(<SectionCards />);

    const wrapper = document.querySelector("[data-pf-kpi-cards]");
    expect(wrapper).toHaveAttribute("data-pf-kpi-cards", "");
    expect(kpiCards()).toHaveLength(4);
  });

  it("replaces the stock metrics with the recruiting KPIs", () => {
    render(<SectionCards />);

    const cards = kpiCards();

    KPI_CARDS.forEach((expected, index) => {
      const card = cards[index];

      expect(
        within(card).getByText(expected.label),
        `${expected.label} label`,
      ).toBeInTheDocument();
      expect(
        within(card).getByText(expected.value),
        `${expected.label} value`,
      ).toBeInTheDocument();
      expect(
        within(card).getByText(expected.trend),
        `${expected.label} trend`,
      ).toBeInTheDocument();
      expect(
        within(card).getByText(expected.primary),
        `${expected.label} trend line`,
      ).toBeInTheDocument();
      expect(
        within(card).getByText(expected.context),
        `${expected.label} context line`,
      ).toBeInTheDocument();
    });
  });

  it("keeps every delta upward, matching the positive recruiting trends", () => {
    render(<SectionCards />);

    for (const card of kpiCards()) {
      const badge = card.querySelector("[data-slot='badge']");
      expect(badge, "trend badge").not.toBeNull();
      expect(
        badge!.querySelector("svg.tabler-icon-trending-up"),
        "upward trend glyph",
      ).not.toBeNull();
      expect(
        badge!.querySelector("svg.tabler-icon-trending-down"),
        "downward trend glyph",
      ).toBeNull();
    }
  });

  it("keeps the growth marker on the fourth card's primary footer line", () => {
    render(<SectionCards />);

    const marked = document.querySelectorAll("[data-pf-growth-footer]");
    expect(marked).toHaveLength(1);

    const cards = kpiCards();
    expect(cards[3].contains(marked[0])).toBe(true);
    expect(marked[0]).toHaveTextContent(KPI_CARDS[3].primary);
    expect(marked[0]).not.toHaveTextContent(KPI_CARDS[3].context);

    // Geometry contract: the marker stays on the footer's primary line, with the
    // shared line-clamp composition the measured stylesheet targets.
    expect(
      marked[0].matches("[data-slot='card-footer'] > div:first-child"),
    ).toBe(true);
    expect(marked[0].className).toContain("line-clamp-1 flex gap-2 font-medium");
    expect(
      marked[0].querySelector("svg.tabler-icon-trending-up"),
    ).not.toBeNull();
  });

  it("leaves no stock shadcn metric on the rendered cards", () => {
    render(<SectionCards />);

    for (const stock of [
      "Total Revenue",
      "$1,250.00",
      "New Customers",
      "1,234",
      "Active Accounts",
      "45,678",
      "Growth Rate",
      "4.5%",
      "Trending up this month",
      "Down 20% this period",
      "Strong user retention",
      "Steady performance increase",
      "Visitors for the last 6 months",
      "Acquisition needs attention",
      "Engagement exceed targets",
      "Meets growth projections",
    ]) {
      expect(screen.queryByText(stock), `${stock} stock string`).toBeNull();
    }
  });

  it("introduces no raw color value", () => {
    expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
  });
});
