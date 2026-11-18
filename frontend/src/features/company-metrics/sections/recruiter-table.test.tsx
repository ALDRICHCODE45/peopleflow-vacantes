import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// jsdom has no matchMedia for the Base UI dialog; «Qué mide cada columna» stays closed here.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));
import { andrea, card, carlos } from "../test-fixtures";
import { RecruiterTable } from "../recruiter-table";

const href = (person: { user_id: string }) => `/empresa/metricas/reclutadores/${person.user_id}?from=2026-08-01&to=2026-10-31`;

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("full recruiter table on a narrow screen (rule 14)", () => {
  it("lists each person as a stacked row with every column's figure, instead of a table that scrolls sideways", () => {
    render(<RecruiterTable items={[card(), carlos(), andrea()]} href={href} />);
    const list = screen.getByRole("list", { name: "Reclutadores" });
    expect(list).toHaveClass("md:hidden");
    expect(screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" }).closest(".hidden")).toHaveClass("md:block");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const mariana = within(items.find(item => within(item).queryByRole("link", { name: "Mariana Torres" }))!);
    expect(mariana.getByRole("link", { name: "Ver ficha de Mariana Torres" })).toHaveAttribute("href", href(card()));
    const terms = mariana.getAllByRole("term").map(term => term.textContent);
    expect(terms).toEqual(["Asignadas", "Entregas", "Mediana a la meta", "Entregados", "Placements", "Conversión", "Reasignaciones", "Días en tramos"]);
    const value = (term: string) => mariana.getAllByRole("term").find(node => node.textContent === term)!.nextElementSibling!.textContent;
    expect(value("Asignadas")).toBe("115 nuevas");
    expect(value("Entregas")).toBe("6 a tiempo1 tarde · 1 vencida");
    expect(value("Mediana a la meta")).toBe("10 días hábiles");
    expect(value("Conversión")).toBe("75%6 de 8");
    expect(value("Días en tramos")).toBe("201");
  });
});
