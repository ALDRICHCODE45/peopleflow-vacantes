import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ChartAreaInteractive,
  chartData,
  formatTickLabel,
} from "./chart-area-interactive";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(
    process.cwd(),
    "src/components/company-dashboard/chart-area-interactive.tsx",
  ),
  "utf8",
);

// jsdom implements neither matchMedia nor ResizeObserver. The chart reads the
// first through `useIsMobile` and recharts the second, so both are stubbed to
// the desktop branch.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1280);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard application-source chart", () => {
  beforeEach(stubBrowserApis);

  it("titles the chart for the application-source composition", () => {
    render(<ChartAreaInteractive />);

    expect(screen.getByText("Origen de las postulaciones")).toBeInTheDocument();
  });

  it("keeps the preserved chart marker on the chart card", () => {
    render(<ChartAreaInteractive />);

    const card = document.querySelector("[data-pf-chart-card]");
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute("data-pf-chart-card", "");
    expect(card).toHaveAttribute("data-slot", "card");
    expect(document.querySelector("[data-slot='chart']")).not.toBeNull();
  });

  it("describes the default 90-day period in Spanish", () => {
    render(<ChartAreaInteractive />);

    const card = document.querySelector("[data-pf-chart-card]")!;
    const description = card.querySelector("[data-slot='card-description']")!;

    expect(within(description as HTMLElement).getByText(
      "Reparto de los últimos 3 meses",
    )).toBeInTheDocument();
    expect(within(description as HTMLElement).getByText("Últimos 3 meses")).toBeInTheDocument();
  });

  it("switches the period description with the range control", async () => {
    const user = userEvent.setup();
    render(<ChartAreaInteractive />);

    await user.click(screen.getByRole("button", { name: "Últimos 30 días" }));

    expect(
      screen.getByText("Reparto de los últimos 30 días"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reparto de los últimos 3 meses")).toBeNull();
  });

  it("keeps the 90d/30d/7d selector semantics", async () => {
    const user = userEvent.setup();
    render(<ChartAreaInteractive />);

    for (const value of ["90d", "30d", "7d"]) {
      expect(source, `${value} range value`).toContain(`value="${value}"`);
    }

    await user.click(screen.getByRole("button", { name: "Últimos 7 días" }));

    expect(screen.getByText("Reparto de los últimos 7 días")).toBeInTheDocument();
  });

  it("labels the mobile range select in Spanish", () => {
    render(<ChartAreaInteractive />);

    expect(screen.getByLabelText("Seleccionar período")).toBeInTheDocument();
  });

  it("maps Directas to violet and Referidas to the decorative lavender", () => {
    const config = source.slice(source.indexOf("const chartConfig = {"));

    expect(config).toMatch(
      /directas:\s*\{[\s\S]*?label:\s*"Directas"[\s\S]*?color:\s*"var\(--primary\)"/,
    );
    expect(config).toMatch(
      /referidas:\s*\{[\s\S]*?label:\s*"Referidas"[\s\S]*?color:\s*"var\(--brand-decorative-strong\)"/,
    );
  });

  it("emits the canonical series tokens on the rendered chart", () => {
    render(<ChartAreaInteractive />);

    const css = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");

    expect(css).toContain("--color-directas: var(--primary)");
    expect(css).toContain("--color-referidas: var(--brand-decorative-strong)");
  });

  it("keeps deterministic UTC date handling with Spanish labels", () => {
    // The data dates are UTC-midnight ISO days. On this host (America/Mexico_City,
    // UTC-6) formatting them in local time renders 2024-04-03 as "2 abr".
    expect(source).toMatch(/timeZone:\s*"UTC"/);
    expect(formatTickLabel("2024-04-03")).toBe("3 abr");
    expect(formatTickLabel("2024-04-03")).not.toBe("2 abr");
    expect(formatTickLabel("2024-06-30")).toBe(
      new Date("2024-06-30T00:00:00Z").toLocaleDateString("es", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    );
  });

  it("covers the whole 90-day window with nonnegative recruiting counts", () => {
    expect(chartData).toHaveLength(91);
    expect(chartData[0].date).toBe("2024-04-01");
    expect(chartData[chartData.length - 1].date).toBe("2024-06-30");

    chartData.forEach((row, index) => {
      const expectedDate = new Date(Date.UTC(2024, 3, 1) + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(row.date, `row ${index} date`).toBe(expectedDate);

      for (const series of ["directas", "referidas"] as const) {
        expect(
          Number.isInteger(row[series]),
          `${row.date} ${series} must be an integer count`,
        ).toBe(true);
        expect(
          row[series],
          `${row.date} ${series} must be nonnegative`,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("leaves no stock chart string", () => {
    render(<ChartAreaInteractive />);

    for (const stock of [
      "Total Visitors",
      "Total for the last 3 months",
      "Last 3 months",
      "Last 30 days",
      "Last 7 days",
      "An interactive area chart",
    ]) {
      expect(screen.queryByText(stock), `${stock} stock string`).toBeNull();
      expect(source, `${stock} in source`).not.toContain(`"${stock}"`);
    }
    for (const stock of ['"Visitors"', '"Desktop"', '"Mobile"', '"desktop"', '"mobile"']) {
      expect(source, `${stock} series key`).not.toContain(stock);
    }
  });
});

describe("company dashboard chart header geometry", () => {
  beforeEach(stubBrowserApis);

  it("keeps the full desktop heading and a concise mobile heading", () => {
    render(<ChartAreaInteractive />);

    // The long heading wrapped onto a second 24px line below the card's 540px
    // breakpoint and pushed the mobile chart down to 406px. The concise mobile
    // title keeps the header on one line at the accepted 382px.
    const full = screen.getByText("Origen de las postulaciones");
    const short = screen.getByText("Postulaciones");

    expect(full.className).toContain("hidden");
    expect(full.className).toContain("@[540px]/card:inline");
    expect(short.className).toContain("@[540px]/card:hidden");
    // The mobile title carries no base-level hide: it is visible by default and
    // only the wide-card variant hides it.
    expect(short.className.split(/\s+/)).not.toContain("hidden");
  });

  it("keeps both headings in the card title slot without touching the header surface", () => {
    render(<ChartAreaInteractive />);

    const title = document.querySelector("[data-slot='card-title']");
    expect(title).not.toBeNull();
    expect(title!.contains(screen.getByText("Origen de las postulaciones"))).toBe(
      true,
    );
    expect(title!.contains(screen.getByText("Postulaciones"))).toBe(true);

    // The subtitle and the range controls keep their own slots, so the mobile
    // fix changes the heading only.
    const description = document.querySelector("[data-slot='card-description']");
    const action = document.querySelector("[data-slot='card-action']");
    expect(description).not.toBeNull();
    expect(action).not.toBeNull();
    expect(title!.contains(description)).toBe(false);
    expect(title!.contains(action)).toBe(false);
  });

  it("keeps the range control at the accepted 352px geometry", () => {
    render(<ChartAreaInteractive />);

    const group = document.querySelector("[data-slot='toggle-group']");
    expect(group).not.toBeNull();

    // w-88 is the existing Tailwind spacing step for 352px (22rem at the 16px
    // root): the accepted desktop width, restored without raw CSS.
    expect(group!.className).toContain("w-88");
    // Equal-flex items split that fixed width three ways, so the Spanish labels
    // stay and the segmented control keeps its canonical interactions.
    expect(group!.className).toContain("*:data-[slot=toggle-group-item]:flex-1");
    expect(group!.className).toContain(
      "*:data-[slot=toggle-group-item]:px-[13px]!",
    );

    const items = Array.from(
      document.querySelectorAll("[data-slot='toggle-group-item']"),
    );
    expect(items).toHaveLength(3);
    for (const item of items) {
      // 32px height and single-line labels survive the width restore.
      expect(item.className).toContain("h-8");
      expect(item.className).toContain("whitespace-nowrap");
    }

    expect(group).toHaveAttribute("data-variant", "outline");
    expect(group).toHaveAttribute("data-spacing", "0");
  });
});
