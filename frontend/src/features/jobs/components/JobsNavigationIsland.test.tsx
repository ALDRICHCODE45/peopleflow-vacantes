import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { JobsNavigationIsland } from "./JobsNavigationIsland";
const source = readFileSync(join(process.cwd(), "src/features/jobs/components/JobsNavigationIsland.tsx"), "utf8");
afterEach(() => { cleanup(); push.mockReset(); });

describe("JobsNavigationIsland boundaries", () => {
  it("keeps one stable island and the desktop-only outward margin", () => {
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes?work_mode=remote" query={{ work_mode: "remote" }}><p>resultados</p></JobsNavigationIsland>);
    const islands = container.querySelectorAll("[data-jobs-navigation-island]");
    expect(islands).toHaveLength(1);
    expect(islands[0]).toHaveClass("md:-mx-[7px]");
    expect(islands[0]).not.toHaveClass("-mx-[7px]");
    expect(screen.getByRole("button", { name: "Buscar" })).toBeVisible();
    expect(screen.getByText("resultados")).toBeVisible();
  });
  it("keeps the generic no-query boundary unwidened", () => {
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes"><p>contenido</p></JobsNavigationIsland>);
    expect(container.querySelector("[data-jobs-navigation-island]")).toBeNull();
    expect(source.match(/md:-mx-\[7px\]/gu)).toHaveLength(1);
  });
  it("keeps the mobile Sheet title, fixed footer and shrinking scroll body", () => {
    expect(source).toContain("<SheetTitle>Filtrar vacantes</SheetTitle>");
    expect(source).toContain('<SheetFooter className="border-t">');
    expect(source).toContain('form="mobile-job-filters"');
    expect(source).toMatch(/className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto[^"]*"[\s\S]{0,240}?data-nav-intent="mobile-filters"/u);
    expect(source).toContain('filterFields("desktop-")');
    expect(source).toContain('filterFields("mobile-")');
    expect(source).not.toContain("JobsVisualPreferences");
  });
  it("resets all filters and cursor through Todas", () => {
    render(<JobsNavigationIsland routeKey="/vacantes?q=Go&contract_type=indefinite&cursor=old" query={{ q: "Go", contract_type: "indefinite", cursor: "old" }}><p>resultados</p></JobsNavigationIsland>);
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(push).toHaveBeenCalledWith("/vacantes");
  });
  it("commits new text while preserving the canonical filters and clearing the cursor", () => {
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes?contract_type=indefinite&cursor=old" query={{ contract_type: "indefinite", cursor: "old" }}><p>resultados</p></JobsNavigationIsland>);
    fireEvent.change(screen.getByLabelText("Buscar vacantes"), { target: { value: " Go " } });
    fireEvent.submit(container.querySelector('form[data-nav-intent="search"]')!);
    expect(push).toHaveBeenCalledWith("/vacantes?q=Go&contract_type=indefinite");
  });
});
