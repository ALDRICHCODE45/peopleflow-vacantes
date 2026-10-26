import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Base UI popup positioning does not complete in jsdom; retain its controlled contract.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type State = { items: { value: string | null; label: string }[]; value: string | null; onValueChange: (value: string) => void; name?: string };
  const Context = React.createContext<State | null>(null);
  return {
    Select: ({ children, ...props }: State & { children: React.ReactNode }) => <Context.Provider value={props}>{children}</Context.Provider>,
    SelectTrigger: (props: React.ComponentProps<"select">) => {
      const state = React.useContext(Context)!;
      return <select {...props} name={state.name} value={state.value ?? ""} onChange={event => state.onValueChange(event.target.value)}>{state.items.map(item => <option key={item.label} value={item.value ?? ""}>{item.label}</option>)}</select>;
    },
    SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
  };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import { JobsNavigationIsland } from "./JobsNavigationIsland";
import { buildJobsUrl, type JobsQuery } from "../url";
const source = readFileSync(join(process.cwd(), "src/features/jobs/components/JobsNavigationIsland.tsx"), "utf8");
afterEach(() => { cleanup(); push.mockReset(); });

describe("salary filter commits", () => {
  function setup(query: JobsQuery = {}) {
    return render(<JobsNavigationIsland routeKey={buildJobsUrl({ ...query, cursor: "old" })} query={query}><p>resultados</p></JobsNavigationIsland>);
  }
  function amount(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  function apply() { fireEvent.submit(screen.getByRole("form", { name: "Filtros" })); }
  it("shows the URL's search when the island stays mounted across a client navigation (browser Back)", () => {
    const view = setup({ q: "frontend" });
    expect(screen.getByLabelText("Buscar vacantes")).toHaveValue("frontend");
    view.rerender(<JobsNavigationIsland routeKey={buildJobsUrl({})} query={{}}><p>resultados</p></JobsNavigationIsland>);
    expect(screen.getByLabelText("Buscar vacantes")).toHaveValue("");
    view.rerender(<JobsNavigationIsland routeKey={buildJobsUrl({ q: "react" })} query={{ q: "react" }}><p>resultados</p></JobsNavigationIsland>);
    expect(screen.getByLabelText("Buscar vacantes")).toHaveValue("react");
  });
  it("announces loading beside the quick filters instead of in an empty row of its own", () => {
    setup();
    const row = screen.getByRole("group", { name: "Filtros rápidos" }).parentElement!;
    expect(within(row).getByRole("status")).toHaveAttribute("aria-live", "polite");
    const island = row.parentElement!;
    expect(island).toHaveAttribute("data-jobs-navigation-island");
    expect(island.querySelector(":scope > [role='status']")).toBeNull();
  });
  it("collapses the empty active-filter chips row so it takes no gap of its own", () => {
    setup();
    const chips = document.querySelector("[aria-label='Filtros activos']")!;
    expect(chips).toBeEmptyDOMElement();
    // `display: none` when empty: a zero-height flex child would still add a 24px gap.
    expect(chips).toHaveClass("empty:hidden");
  });
  it.each([
    ["30000", ""], ["", "40000"], ["30000.50", "40000"], ["40000", "40000"], ["0", ""],
  ])("commits inclusive bounds %s / %s with default units", (min, max) => {
    setup({ work_mode: "remote" });
    amount("Salario desde", min);
    amount("Salario hasta", max);
    apply();
    expect(push).toHaveBeenCalledWith(buildJobsUrl({ work_mode: "remote", salary_min: min, salary_max: max }));
  });
  it("initializes amounts and units from the URL and clears the whole group", () => {
    setup({ salary_min: "100", salary_max: "200", salary_currency: "USD", salary_period: "semimonthly", salary_basis: "net" });
    expect(screen.getByLabelText("Salario desde")).toHaveValue("100");
    expect(screen.getByLabelText("Salario hasta")).toHaveValue("200");
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue("USD");
    expect(screen.getByRole("combobox", { name: "Periodo de pago" })).toHaveValue("semimonthly");
    expect(screen.getByRole("combobox", { name: "Base salarial" })).toHaveValue("net");
    amount("Salario desde", ""); amount("Salario hasta", ""); apply();
    expect(push).toHaveBeenCalledWith("/vacantes");
  });
  it("commits changed units", () => {
    setup(); amount("Salario desde", "30000");
    for (const [label, value] of [["Moneda", "USD"], ["Periodo de pago", "semimonthly"], ["Base salarial", "net"]]) {
      fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
    }
    apply();
    expect(push).toHaveBeenCalledWith("/vacantes?salary_min=30000&salary_currency=USD&salary_period=semimonthly&salary_basis=net");
  });
  it.each(["1,000", "-1", "+1", "1e3", "1.234", " 100 "])("rejects invalid amount %s without navigation", value => {
    setup(); amount("Salario desde", value); apply();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Salario desde")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Escribe un monto sin comas ni signos, con hasta dos decimales.")).toBeVisible();
  });
  it("rejects reversed bounds and focuses the maximum", () => {
    setup(); amount("Salario desde", "40000"); amount("Salario hasta", "30000"); apply();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("El salario hasta debe ser mayor o igual al salario desde.")).toBeVisible();
    expect(screen.getByLabelText("Salario hasta")).toHaveFocus();
  });
  it("counts salary once and clears it with its chip", () => {
    setup({ salary_min: "30000", salary_max: "40000", salary_currency: "MXN", salary_period: "monthly", salary_basis: "gross" });
    expect(screen.getByRole("button", { name: "Filtros (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quitar filtro Salario:.*30,000.*40,000.*MXN.*mensual.*bruto/ }));
    expect(push).toHaveBeenCalledWith("/vacantes");
  });
  it("keeps the salary chip inside the active filters group, after the other chips", () => {
    setup({ work_mode: "remote", salary_min: "30000" });
    const chips = within(screen.getByLabelText("Filtros activos")).getAllByRole("button");
    expect(chips.map(chip => chip.getAttribute("aria-label"))).toEqual(["Quitar filtro Modalidad: Remoto", expect.stringMatching(/^Quitar filtro Salario: Desde \$30,000 MXN/)]);
  });
  it("lets every filter list grow to its longest option instead of clipping it in the narrow sidebar", () => {
    const salarySource = readFileSync(join(process.cwd(), "src/features/jobs/components/JobsSalaryFilter.tsx"), "utf8");
    for (const text of [source, salarySource]) {
      const lists = text.match(/<SelectContent[^>]*>/gu) ?? [];
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) expect(list).toContain('className="min-w-max"');
    }
  });
  it("shows currency codes in the narrow trigger", () => {
    setup();
    expect(within(screen.getByRole("combobox", { name: "Moneda" })).getAllByRole("option").map(option => option.textContent)).toEqual(["MXN", "USD"]);
  });
  it("clears salary through Todas", () => {
    setup({ salary_min: "30000" });
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(push).toHaveBeenCalledWith("/vacantes");
  });
  it("adopts the next URL after navigation without retaining old amounts", () => {
    const view = setup({ salary_min: "30000" });
    view.rerender(<JobsNavigationIsland routeKey="/vacantes?salary_max=40000" query={{ salary_max: "40000" }}><p>resultados</p></JobsNavigationIsland>);
    expect(screen.getByLabelText("Salario desde")).toHaveValue("");
    expect(screen.getByLabelText("Salario hasta")).toHaveValue("40000");
  });
  it("keeps invalid mobile bounds open and does not navigate", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("#mobile-salary_min")!, { target: { value: "40000" } });
    fireEvent.change(dialog.querySelector("#mobile-salary_max")!, { target: { value: "30000" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(push).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
    expect(dialog.querySelector("#mobile-salary_max")).toHaveAttribute("aria-invalid", "true");
  });
  it("shares the draft with the mobile Sheet and commits there", async () => {
    setup(); amount("Salario desde", "30000");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = await screen.findByRole("dialog");
    const mobile = dialog.querySelector<HTMLInputElement>("#mobile-salary_max")!;
    expect(dialog.querySelector("#mobile-salary_min")).toHaveValue("30000");
    fireEvent.change(mobile, { target: { value: "40000" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(push).toHaveBeenCalledWith(buildJobsUrl({ salary_min: "30000", salary_max: "40000" }));
  });
});

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
