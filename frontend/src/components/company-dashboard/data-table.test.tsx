import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataTable, formatReceivedDate } from "./data-table";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dashboard } from "@/features/employer-dashboard/test-fixtures";
const source = readFileSync("src/components/company-dashboard/data-table.tsx", "utf8");
const applicants = Array.from({ length: 12 }, (_, i) => ({ ...dashboard.recent[i % 2], participation_id: `participation-${i}`, candidate: { ...dashboard.recent[i % 2].candidate, name: `Persona ${i}`, professional_title: i === 0 ? "Ingeniera" : null } }));
function tableBody() { return document.querySelector<HTMLElement>("[data-slot='table-body']")!; }
function bodyRows() { return Array.from(tableBody().querySelectorAll("tr")); }
function toggleCheckbox(name: string) { const control = screen.getByRole("checkbox", { name }); fireEvent.click(control.parentElement!.querySelector("input[type='checkbox']")!); }

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.stubGlobal("innerWidth", 1280); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps the approved toolbar, origin tabs, column control and empty state", () => { render(<DataTable data={[]} />); expect(screen.getByText("Sin candidatos")).toBeInTheDocument(); expect(screen.getByRole("tab", { name: "Todos 0" })).toBeInTheDocument(); expect(screen.getByRole("tab", { name: "Orgánicos 0" })).toBeInTheDocument(); expect(screen.getByRole("tab", { name: "Manuales 0" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Personalizar columnas" })).toBeInTheDocument(); });
it("renders participation source independently from candidate kind and opens the vacancy", () => {
  render(<DataTable data={[{ participation_id: "p", candidate: { id: "c", kind: "organic", name: "Ana", professional_title: "Ingeniera" }, vacancy: { id: "v", title: "Go" }, stage: { id: "s", name: "Entrevista", kind: "in_process" }, source: "manual", added_by: { id: "a", name: "María" }, applied_at: "2026-10-24T01:00:00Z" }]} />);
  for (const column of ["Candidato", "Vacante", "Etapa", "Origen", "Recibida", "Agregado por"]) expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
  expect(screen.getByText("Manual")).toHaveAttribute("data-slot", "badge"); expect(screen.getByText("Entrevista")).toHaveAttribute("data-variant", "review"); expect(screen.getByText("Ingeniera")).toBeInTheDocument(); expect(screen.getByRole("tab", { name: "Manuales 1" })).toBeInTheDocument(); expect(screen.getByText("María")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ana" })).toHaveAttribute("href", "/empresa/vacantes/v/pipeline");
  fireEvent.click(screen.getByText("Entrevista")); expect(push).toHaveBeenCalledWith("/empresa/vacantes/v/pipeline");
});
it("opens the detail from «Ver detalle» when the candidate has no professional title", () => {
  render(<DataTable data={[{ participation_id: "p", candidate: { id: "c", kind: "organic", name: "Ana", professional_title: null }, vacancy: { id: "v", title: "Go" }, stage: { id: "s", name: "Nuevos", kind: "new" }, source: "organic", added_by: null, applied_at: "2026-10-24T01:00:00Z" }]} />);
  expect(screen.getByRole("button", { name: "Ver detalle de Ana" })).toHaveTextContent("Ver detalle");
});
it("uses the Mexico City day, not the UTC day", () => { expect(formatReceivedDate("2026-10-24T01:00:00Z")).toBe("23 oct 2026"); });
it("keeps one tabs root, a single panel and title in the approved toolbar", () => {
  render(<DataTable data={applicants} />);
  const root = document.querySelectorAll("[data-pf-data-table]");
  expect(root).toHaveLength(1); expect(root[0]).toHaveAttribute("data-slot", "tabs");
  expect(document.querySelectorAll("[data-slot='tabs-content']")).toHaveLength(1);
  const toolbar = screen.getByRole("heading", { name: "Candidatos recientes" }).parentElement!;
  expect(within(toolbar).getByRole("tablist")).toBeInTheDocument();
  expect(toolbar).toHaveClass("flex-wrap", "gap-y-3"); expect(toolbar).not.toHaveClass("px-4");
});
it("keeps ten rows on the first page and all seven columns including selection", () => {
  render(<DataTable data={applicants} />);
  expect(bodyRows()).toHaveLength(10); expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  expect(tableBody().querySelectorAll("td")).toHaveLength(70);
});
it("keeps neutral, dotless, circular tab counters with counts by participation origin", () => {
  render(<DataTable data={applicants} />);
  for (const [label, count] of [["Todos", 12], ["Orgánicos", 6], ["Manuales", 6]]) expect(screen.getByRole("tab", { name: `${label} ${count}` })).toBeInTheDocument();
  for (const badge of screen.getByRole("tablist").querySelectorAll("[data-slot='badge']")) { expect(badge).toHaveAttribute("data-variant", "secondary"); expect(badge).not.toHaveAttribute("data-dot"); }
  expect(screen.getByRole("tablist")).toHaveClass("**:data-[slot=badge]:rounded-full");
});
it.each([['organic', 'Orgánicos'], ['manual', 'Manuales']] as const)("filters %s rows and returns to Todos", async (origin, label) => {
  const user = userEvent.setup(); render(<DataTable data={applicants} />);
  await user.click(screen.getByRole("tab", { name: `${label} 6` })); expect(bodyRows()).toHaveLength(6);
  expect(screen.getByLabelText("Filtrar por origen")).toHaveTextContent(label);
  expect(within(tableBody()).queryAllByText(origin === "organic" ? "Manual" : "Orgánico")).toHaveLength(0);
  await user.click(screen.getByRole("tab", { name: "Todos 12" })); expect(bodyRows()).toHaveLength(10);
});
it("resets pagination when narrowing origin", async () => {
  const user = userEvent.setup(); render(<DataTable data={applicants} />);
  await user.click(screen.getByRole("button", { name: "Ir a la página siguiente" })); expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Orgánicos 6" })); expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
});
it("keeps page-scoped selection and does not navigate when selecting", () => {
  push.mockClear(); render(<DataTable data={applicants} />);
  toggleCheckbox("Seleccionar a Persona 0"); expect(screen.getByText("1 de 12 candidatos seleccionados.")).toBeInTheDocument();
  toggleCheckbox("Seleccionar todas las filas"); expect(screen.getByText("10 de 12 candidatos seleccionados.")).toBeInTheDocument(); expect(push).not.toHaveBeenCalled();
});
it("keeps the column menu responsive labels and visibility wiring", () => {
  render(<DataTable data={applicants} />);
  expect(screen.getByRole("button", { name: "Personalizar columnas" })).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.getByText("Columnas")).toHaveClass("hidden", "sm:inline", "lg:hidden");
  expect(screen.getByText("Personalizar columnas")).toHaveClass("hidden", "lg:inline");
  expect(source).toMatch(/getCanHide\(\)[\s\S]*toggleVisibility/);
  for (const label of ["Vacante", "Etapa", "Origen", "Recibida", "Agregado por"]) expect(source).toContain(`"${label}"`);
});
it("keeps localized pagination navigable in both directions", async () => {
  const user = userEvent.setup(); render(<DataTable data={applicants} />);
  expect(screen.getByRole("combobox", { name: "Filas por página" })).toHaveTextContent("10");
  await user.click(screen.getByRole("button", { name: "Ir a la última página" })); expect(bodyRows()).toHaveLength(2); expect(screen.getByText("Persona 11")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ir a la primera página" })); expect(bodyRows()).toHaveLength(10);
});
it("keeps the read-only drawer on the subline while the name links to the board", async () => {
  const user = userEvent.setup(); render(<DataTable data={applicants} />);
  expect(screen.getByRole("link", { name: "Persona 0" })).toHaveAttribute("href", `/empresa/vacantes/${applicants[0].vacancy.id}/pipeline`);
  await user.click(screen.getByRole("button", { name: "Ver detalle de Persona 0" }));
  const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByText("Ingeniera")).toBeInTheDocument();
  expect(within(dialog).getByText("Entrevista")).toHaveAttribute("data-variant", "review");
  expect(within(dialog).getAllByRole("button")).toHaveLength(1); expect(within(dialog).queryByText("Experiencia")).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Cerrar" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it.each([['new', 'info'], ['screening', 'review'], ['screening_ok', 'review'], ['in_process', 'review'], ['custom', 'review'], ['placement', 'success'], ['discarded', 'neutral']] as const)("maps %s stage kind independently of its renamed label", (kind, tone) => {
  render(<DataTable data={[{ ...applicants[0], stage: { ...applicants[0].stage, name: "Etiqueta personalizada", kind } }]} />);
  const badge = screen.getByText("Etiqueta personalizada"); expect(badge).toHaveAttribute("data-variant", tone); expect(badge).toHaveAttribute("data-dot");
  expect(screen.getByText("Orgánico")).not.toHaveAttribute("data-dot");
});
it("clears an empty origin filter without sending the recruiter away", async () => {
  const user = userEvent.setup(); render(<DataTable data={[applicants[0]]} />);
  await user.click(screen.getByRole("tab", { name: "Manuales 0" })); expect(screen.getByText("Sin candidatos")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Limpiar filtros" })); expect(screen.getByRole("link", { name: "Persona 0" })).toBeInTheDocument();
});
it("has no prototype editors, drag reorder, fake experience, chart or raw colors", () => {
  render(<DataTable data={applicants} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  for (const token of ["@dnd-kit", "yearsOfExperience", "recharts", "toast", "Add Section"]) expect(source).not.toContain(token);
  expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
});
