import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { ApplicationsWorkspace } from "./applications-workspace";

vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const item = (id: string, title: string, company: string) => ({
  id, vacancy: { id: `0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d${id}`, title }, company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7dff", name: company },
  applied_at: "2026-10-16T18:00:00.000000Z", status: "submitted" as const, message: null,
});
beforeEach(() => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [item("01", "Diseñadora UX", "Acme"), item("02", "Backend Go", "Ñandú Labs")], next_cursor: null } });
});
afterEach(cleanup);

it("searches loaded applications by title or company ignoring case and accents", async () => {
  render(<ApplicationsWorkspace />);
  const search = await screen.findByRole("searchbox", { name: "Buscar por puesto o empresa" });
  const list = () => screen.getByRole("list");
  fireEvent.change(search, { target: { value: "disenadora" } });
  expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
  expect(within(list()).getByText("Diseñadora UX")).toBeVisible();
  fireEvent.change(search, { target: { value: "NANDU" } });
  expect(within(list()).getByText("Backend Go")).toBeVisible();
  expect(within(list()).queryByText("Diseñadora UX")).toBeNull();
});

it("explains an empty search and clears it", async () => {
  render(<ApplicationsWorkspace />);
  const search = await screen.findByRole("searchbox", { name: "Buscar por puesto o empresa" });
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.getByText("Ninguna postulación coincide con «zzz».")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
  expect(search).toHaveValue("");
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
});

it("says the search covers only loaded pages while more remain", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [item("01", "Diseñadora UX", "Acme")], next_cursor: "next" } });
  render(<ApplicationsWorkspace />);
  const search = await screen.findByRole("searchbox", { name: "Buscar por puesto o empresa" });
  fireEvent.change(search, { target: { value: "acme" } });
  expect(screen.getByText("La búsqueda cubre las postulaciones cargadas. Carga más para buscar en el resto.")).toBeVisible();
});
