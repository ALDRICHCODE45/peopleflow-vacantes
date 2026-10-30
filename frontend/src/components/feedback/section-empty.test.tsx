import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ListChecks, SearchX } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";

afterEach(cleanup);

it("renders the Empty anatomy inside an existing card without nesting another Card", () => {
  const add = vi.fn();
  const { container } = render(<SectionEmpty icon={ListChecks} tone="info" title="Esta vacante todavía no tiene criterios" description="Define qué revisar en cada candidato." primaryAction={{ label: "Agregar criterio", onClick: add }} secondaryAction={{ label: "Ver configuración", href: "/empresa/vacantes/1/configuracion/checklist" }} />);
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  const empty = container.querySelector('[data-slot="empty"]')!;
  expect(empty).toHaveClass("py-8");
  expect(empty.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-primary/10");
  expect(screen.getByRole("heading", { name: "Esta vacante todavía no tiene criterios", level: 3 })).toHaveClass("text-base", "font-semibold");
  expect(empty.querySelector('[data-slot="empty-description"]')).toHaveTextContent("Define qué revisar en cada candidato.");
  const content = empty.querySelector('[data-slot="empty-content"]')!;
  expect(content).toContainElement(screen.getByRole("button", { name: "Agregar criterio" }));
  expect(content).toContainElement(screen.getByRole("link", { name: "Ver configuración" }));
  expect(screen.getByRole("button", { name: "Agregar criterio" })).toHaveClass("min-h-10");
  fireEvent.click(screen.getByRole("button", { name: "Agregar criterio" }));
  expect(add).toHaveBeenCalledOnce();
});

it("renders an instruction-only state (nothing selected) without buttons or announcements", () => {
  const { container } = render(<SectionEmpty icon={ListChecks} tone="empty" title="Selecciona un criterio para verlo aquí" description="Elige uno de la lista para revisar sus datos." />);
  expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  expect(container.querySelector('[data-slot="empty-content"]')).toBeNull();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("lets the caller set the heading level and an opt-in live region for no-results updates", () => {
  render(<SectionEmpty icon={SearchX} tone="empty" role="status" headingLevel={2} title="Sin resultados" description="No hay candidatos que coincidan con «Diseño»." primaryAction={{ label: "Limpiar filtros", onClick: () => {} }} />);
  expect(screen.getByRole("status")).toContainElement(screen.getByRole("heading", { name: "Sin resultados", level: 2 }));
});
