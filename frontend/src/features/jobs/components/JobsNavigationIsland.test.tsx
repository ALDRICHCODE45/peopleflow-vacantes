import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { JobsNavigationIsland } from "./JobsNavigationIsland";

/**
 * The island source, so the widened-margin and scroll-body contracts read the
 * shipped bytes. The mobile filters Sheet is measured in Playwright: opening it
 * under jsdom mounts the Base UI `Select` positioner, whose autoUpdate loop
 * never settles there - the same boundary the committed combobox and menu
 * suites document - so a rendering assertion would time out, not verify.
 */
const source = readFileSync(
  join(process.cwd(), "src/features/jobs/components/JobsNavigationIsland.tsx"),
  "utf8",
);

/** jsdom has no PointerEvent, so the Base UI checkbox dispatches through this. */
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("JobsNavigationIsland /vacantes width island (CCP-R9A)", () => {
  it("owns the stable island hook and the exact 7px desktop-only outward margin", () => {
    const { container } = render(
      <JobsNavigationIsland routeKey="/vacantes?currency=MXN" query={{ currency: "MXN" }}>
        <p>resultados</p>
      </JobsNavigationIsland>,
    );
    const islands = container.querySelectorAll("[data-jobs-navigation-island]");
    expect(islands).toHaveLength(1);
    const classes = (islands[0] as HTMLElement).className;
    // Exactly 7px outward on both sides, and only from the `md` breakpoint up:
    // an unscoped negative margin would change the 375px gutters.
    expect(classes).toMatch(/(?:^|\s)md:-mx-\[7px\](?:\s|$)/u);
    expect(classes).not.toMatch(/(?:^|\s)-mx-\[7px\]/u);
    expect(source).toContain("data-jobs-navigation-island");
    expect(source).toContain("md:-mx-[7px]");
    // The island still owns the composed search surface and the server rows.
    expect(screen.getByRole("button", { name: /buscar/iu })).toBeVisible();
    expect(screen.getByText("resultados")).toBeVisible();
  });

  it("leaves the generic no-query boundary unwidened", () => {
    const { container } = render(
      <JobsNavigationIsland routeKey="/vacantes">
        <p>contenido</p>
      </JobsNavigationIsland>,
    );
    expect(container.querySelectorAll("[data-jobs-navigation-island]")).toHaveLength(0);
    expect(container.querySelector("div")?.className ?? "").not.toContain("-mx-");
    expect(source.match(/md:-mx-\[7px\]/gu)).toHaveLength(1);
  });

  it("gives the mobile filters sheet a shrinking body that owns the scroll", () => {
    // The visual-only preferences live after the functional form, so the
    // panel's flex body wraps both: the wrapper owns `min-h-0` and the scroll
    // so the floating sheet keeps its header and footer fixed.
    expect(source).toContain('data-nav-intent="mobile-filters"');
    expect(source).toMatch(
      /className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto[^"]*"[\s\S]{0,240}?data-nav-intent="mobile-filters"/u,
    );
  });
});

describe("JobsNavigationIsland Spanish filter triggers (SVF-2)", () => {
  const filtersRoute =
    "/vacantes?work_mode=remote&seniority=mid&employment_type=full_time&currency=USD";
  const filtersQuery = {
    work_mode: "remote",
    seniority: "mid",
    employment_type: "full_time",
    currency: "USD",
  };

  it("labels the selected enum filters in Spanish while keeping the raw values", () => {
    render(
      <JobsNavigationIsland routeKey={filtersRoute} query={filtersQuery}>
        <p>resultados</p>
      </JobsNavigationIsland>,
    );

    const workMode = screen.getByRole("combobox", { name: "Modalidad" });
    expect(workMode).toHaveTextContent("Remoto");
    expect(workMode).not.toHaveTextContent("remote");

    const seniority = screen.getByRole("combobox", { name: "Senioridad" });
    expect(seniority).toHaveTextContent("Medio");
    expect(seniority).not.toHaveTextContent("mid");

    const employment = screen.getByRole("combobox", { name: "Tipo de empleo" });
    expect(employment).toHaveTextContent("Tiempo completo");
    expect(employment).not.toHaveTextContent("full_time");

    const currency = screen.getByRole("combobox", { name: "Moneda" });
    expect(currency).toHaveTextContent("USD");
  });

  it("submits the raw enum values through the functional filters form", () => {
    const view = render(
      <JobsNavigationIsland routeKey={filtersRoute} query={filtersQuery}>
        <p>resultados</p>
      </JobsNavigationIsland>,
    );

    const form = view.container.querySelector<HTMLFormElement>(
      'form[data-nav-intent="filters"]',
    );
    expect(form).not.toBeNull();
    // The same commit shows the Spanish label and submits the raw enum value.
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toHaveTextContent(
      "Remoto",
    );
    const data = new FormData(form!);
    expect(data.get("work_mode")).toBe("remote");
    expect(data.get("seniority")).toBe("mid");
    expect(data.get("employment_type")).toBe("full_time");
    expect(data.get("currency")).toBe("USD");
    expect(data.get("location")).toBe("");

    fireEvent.submit(form!);
    expect(push).toHaveBeenCalledWith(
      "/vacantes?seniority=mid&work_mode=remote&employment_type=full_time&currency=USD",
    );
  });
});

describe("JobsNavigationIsland visual-only preferences (SVF-2)", () => {
  it("keeps compact preferences outside the functional form and never navigates", () => {
    const view = render(
      <JobsNavigationIsland
        routeKey="/vacantes?location=CDMX&currency=MXN"
        query={{ location: "CDMX", currency: "MXN" }}
      >
        <p>resultados</p>
      </JobsNavigationIsland>,
    );

    const preferences = view.container.querySelector(
      "[data-jobs-visual-preferences]",
    );
    expect(preferences).not.toBeNull();
    const filtersForm = view.container.querySelector<HTMLFormElement>(
      'form[data-nav-intent="filters"]',
    );
    expect(filtersForm).not.toBeNull();
    expect(filtersForm!.contains(preferences)).toBe(false);
    expect(
      preferences!.querySelectorAll("input[name], select[name], textarea[name]"),
    ).toHaveLength(0);
    expect(
      within(preferences as HTMLElement).queryByRole("button", {
        name: /aplicar/i,
      }),
    ).toBeNull();

    fireEvent.change(within(filtersForm!).getByLabelText("Ubicación"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Sueldo mínimo mensual"), {
      target: { value: "25000" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro médico" }));
    expect(push).not.toHaveBeenCalled();

    fireEvent.submit(filtersForm!);
    expect(push).toHaveBeenCalledWith("/vacantes?currency=MXN");
  });

  it("renders the same visual preferences inside the mobile sheet surface", () => {
    expect(source).toContain("<JobsVisualPreferences");
    expect(source).toContain('idPrefix="desktop-"');
    expect(source).toContain('idPrefix="mobile-"');
  });
});
