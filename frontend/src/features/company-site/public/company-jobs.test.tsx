import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanyJobs, companyJobDimensions, filterCompanyJobs, type CompanyJobFilters } from "./company-jobs";
import type { PublicJobItem } from "@/features/jobs/types";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
// Same boundary as company-site-page.test: keep the real selection controller;
// jsdom has no positioning for the chips popup in a modal. Portals are tested
// separately with the unmocked Sheet/PreviewFrame in site-portal.test.
vi.mock("@/components/ui/combobox", async importOriginal => {
  const original = await importOriginal<typeof import("@/components/ui/combobox")>();
  return { ...original, ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});
const base = listItem(vacancyDetail);
const jobs: PublicJobItem[] = [
  { ...base, id: "a", title: "Ingeniería sénior", professional_area: "engineering" as const, work_mode: "hybrid" as const, work_schedule: "full_time" as const, contract_type: "indefinite" as const, seniority: "senior" as const },
  { ...base, id: "b", title: "Diseño", professional_area: "design_creative" as const, work_mode: "remote" as const, work_schedule: "part_time" as const, contract_type: "temporary" as const, seniority: "junior" as const },
  { ...base, source: "legacy", id: "c", title: "Legado", professional_area: null, work_mode: "onsite", work_schedule: null, contract_type: null, seniority: "intern", location: null, remote_scope: null, legacy_employment_type: "full_time", compensation: null, legacy_salary: null, benefits_preview: { predefined: [], custom: [] }, benefits_total: 0, skills_preview: [], skills_total: 0, applicants: null, screening_questions: null },
];
const filters = (patch: Partial<CompanyJobFilters> = {}): CompanyJobFilters => ({ search: "", modes: [], states: [], areas: [], schedules: [], contracts: [], levels: [], ...patch });
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([
  { areas: ["engineering"] }, { schedules: ["full_time"] }, { contracts: ["indefinite"] }, { levels: ["senior"] },
])("filters the loaded jobs by %j and excludes legacy nulls", patch => {
  expect(filterCompanyJobs(jobs, filters(patch))).toEqual([jobs[0]]);
});
it("uses OR within each dimension and AND across every active dimension and title", () => {
  expect(filterCompanyJobs(jobs, filters({ areas: ["engineering", "design_creative"] }))).toEqual(jobs.slice(0, 2));
  expect(filterCompanyJobs(jobs, filters({ search: "ingenieria senior", areas: ["engineering", "design_creative"], modes: ["hybrid"], states: [base.location!.state!.id], schedules: ["full_time"], contracts: ["indefinite"], levels: ["senior"] }))).toEqual([jobs[0]]);
  expect(filterCompanyJobs(jobs, filters({ areas: ["engineering"], schedules: ["part_time"] }))).toEqual([]);
  expect(filterCompanyJobs(jobs, filters())).toEqual(jobs);
});
it("omits a missing level rather than inventing an option and excludes it only when filtering", () => {
  const noLevel = { ...base, seniority: null };
  expect(companyJobDimensions([noLevel]).map(d => d.key)).not.toContain("levels");
  expect(filterCompanyJobs([noLevel], filters())).toEqual([noLevel]);
  expect(filterCompanyJobs([noLevel], filters({ levels: ["senior"] }))).toEqual([]);
});
it.each([
  { schedules: ["full_time", "part_time"] },
  { contracts: ["indefinite", "temporary"] },
  { levels: ["senior", "junior"] },
])("allows multiple selected values for %j", patch => {
  expect(filterCompanyJobs(jobs, filters(patch))).toEqual(jobs.slice(0, 2));
});
it("derives only available options, deduplicated and sorted by Spanish label", () => {
  const dimensions = companyJobDimensions([...jobs, jobs[0]]);
  expect(dimensions.map(d => d.label)).toEqual(["Área", "Modalidad", "Ubicación", "Jornada", "Tipo de contrato", "Nivel"]);
  expect(dimensions.find(d => d.key === "modes")?.options.map(o => o.label)).toEqual(["Híbrido", "Presencial", "Remoto"]);
  expect(dimensions.find(d => d.key === "areas")?.options.map(o => o.label)).toEqual(["Diseño y creatividad", "Ingeniería"]);
  expect(dimensions.find(d => d.key === "states")?.options).toEqual([{ value: base.location!.state!.id, label: base.location!.state!.name }]);
});
it("hides empty dimensions and labels location explicitly, not Estado", () => {
  render(<CompanyJobs jobs={[jobs[2]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const panel = screen.getByRole("dialog");
  expect(within(panel).getByRole("combobox", { name: "Modalidad" })).toBeEnabled();
  for (const label of ["Área", "Ubicación", "Jornada", "Tipo de contrato", "Estado"]) expect(within(panel).queryByRole("combobox", { name: label })).toBeNull();
});
it("shows all six dimensions, location help, live count, active value count and clearing", () => {
  render(<CompanyJobs jobs={jobs} />);
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const panel = screen.getByRole("dialog");
  for (const name of ["Área", "Modalidad", "Ubicación", "Jornada", "Tipo de contrato", "Nivel"]) expect(within(panel).getByRole("combobox", { name })).toBeEnabled();
  expect(within(panel).getByText("Estado donde se ubica la vacante.")).toBeVisible();
  fireEvent.click(within(panel).getByRole("option", { name: "Ingeniería" }));
  fireEvent.click(within(panel).getByRole("option", { name: "Tiempo completo" }));
  expect(panel.querySelector('[data-slot="sheet-footer"] [role="status"]')).toHaveTextContent("1 vacante coincide");
  // Trigger is outside the modal's accessible subtree while open.
  expect(document.querySelector('[data-slot="sheet-trigger"]')).toHaveTextContent("Filtros (2)");
  fireEvent.click(within(panel).getByRole("button", { name: "Quitar filtros" }));
  expect(panel.querySelector('[data-slot="sheet-footer"] [role="status"]')).toHaveTextContent("3 vacantes coinciden");
  expect(document.querySelector('[data-slot="sheet-trigger"]')).toHaveTextContent(/^Filtros$/);
});
it("offers the real catalog when the company has no jobs", () => {
  const { container } = render(<CompanyJobs jobs={[]} />);
  expect(screen.getByRole("heading", { name: "Por ahora no hay vacantes abiertas", level: 2 })).toBeVisible();
  expect(screen.getByText("Las nuevas oportunidades de esta empresa aparecerán aquí cuando se publiquen. Mientras tanto, puedes explorar el catálogo de PeopleFlow.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Explorar vacantes en PeopleFlow" })).toHaveAttribute("href", "/vacantes");
  expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  expect(container.querySelector('.lucide-briefcase')).not.toBeNull();
});
it("quotes only a non-empty search and clearing restores jobs", () => {
  const { container } = render(<CompanyJobs jobs={jobs} />);
  const search = screen.getByRole("textbox", { name: "Buscar por título" });
  fireEvent.change(search, { target: { value: "  inexistente  " } });
  expect(screen.getByRole("heading", { name: "Sin resultados", level: 2 })).toBeVisible();
  expect(screen.getByText("No encontramos vacantes para «inexistente». Limpia los filtros para ver las oportunidades de esta empresa.")).toBeVisible();
  expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  expect(container.querySelector('.lucide-search-x')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
  expect(search).toHaveValue("");
  expect(screen.getByRole("link", { name: jobs[0].title })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
});
it("names active dimensions without quoting a blank search and clears them", () => {
  render(<CompanyJobs jobs={jobs} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar por título" }), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const panel = screen.getByRole("dialog");
  fireEvent.click(within(panel).getByRole("option", { name: "Ingeniería" }));
  fireEvent.click(within(panel).getByRole("option", { name: "Remoto" }));
  fireEvent.click(within(panel).getByRole("button", { name: "Ver resultados" }));
  expect(screen.getByRole("heading", { name: "Sin resultados", level: 2 })).toBeVisible();
  expect(screen.getByText("No hay vacantes que coincidan con el área «Ingeniería» y la modalidad «Remoto». Limpia los filtros para ver las oportunidades de esta empresa.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
  for (const job of jobs) expect(screen.getByRole("link", { name: job.title })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Buscar por título" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Filtros" })).toBeVisible();
});
it.each(["list", "cards", "by_area"] as const)("%s links lift above siblings with visible branded hover/focus and a trailing arrow", variant => {
  render(<CompanyJobs jobs={jobs} variant={variant} />);
  for (const job of jobs) {
    const link = screen.getByRole("link", { name: job.title });
    expect(link).toHaveClass("relative", "hover:z-10", "focus-visible:z-10", "hover:ring-ring", "focus-visible:ring-ring", "hover:ring-2", "focus-visible:ring-2");
    expect(link.querySelector('[data-job-arrow]')).not.toBeNull();
    const surface = link.querySelector('[data-slot="card"], [data-slot="item"]');
    expect(surface).toHaveClass("group-hover/job:bg-primary/5", "group-focus-visible/job:bg-primary/5");
  }
});
