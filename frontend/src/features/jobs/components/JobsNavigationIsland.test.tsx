import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  push.mockReset();
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
    // The form that wraps the mobile facet fields is the panel's flex body: it
    // must shrink (`min-h-0`) and scroll itself so the floating sheet keeps its
    // header and footer fixed.
    expect(source).toContain('data-nav-intent="mobile-filters"');
    expect(source).toMatch(
      /data-nav-intent="mobile-filters"[\s\S]{0,240}?className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto/u,
    );
  });
});
