import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { VacancyCard } from "./VacancyCard";
import { JobDetailView } from "./JobDetailView";
import { JobsNavigationIsland } from "./JobsNavigationIsland";
import { JobsResults } from "./JobsResults";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });

it.each([legacyDetail, vacancyDetail])("renders a unified $source card without a publication-time line", (detail) => {
  const { container } = render(<ul><VacancyCard job={listItem(detail)} /></ul>);
  expect(screen.getByRole("link", { name: detail.title })).toHaveAttribute("href", `/vacantes/${detail.id}`);
  expect(container.querySelector("time")).toBeNull();
  expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
  if (detail.source === "vacancy") {
    for (const label of ["Tiempo completo", "Indefinido", "Tecnología y sistemas", "Mensual", "Bruto"]) expect(container).toHaveTextContent(label);
    expect(container).toHaveTextContent("$30,000 – $40,000 MXN");
  } else {
    expect(container).toHaveTextContent("Tiempo completo");
    expect(container).toHaveTextContent("$30,000 – $45,000 MXN");
    expect(container).not.toHaveTextContent(/Mensual|Bruto/);
  }
  expect(container).not.toHaveTextContent(/Hace 5 h|Verificada|Postulantes/);
});

it("renders a vacancy rich description, requirements, benefits and the apply action without internal data", () => {
  const { container } = render(<JobDetailView job={vacancyDetail} />);
  expect(container.querySelector("strong")).toHaveTextContent("Construye servicios seguros.");
  expect(screen.getByRole("heading", { name: "Lo que buscamos" })).toBeVisible();
  expect(screen.getByText("Requisitos indispensables")).toBeVisible();
  expect(screen.getByText("También valoramos")).toBeVisible();
  expect(screen.getByText("Experiencia con Go")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Beneficios para ti" })).toBeVisible();
  expect(screen.getByText("Seguro de gastos médicos")).toBeVisible();
  expect(screen.getByText("Apoyo de transporte")).toBeVisible();
  expect(screen.getByText("16 de octubre de 2026", { selector: "time" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}/postular`);
  expect(container).not.toHaveTextContent(/Próximamente|Disponible pronto|Solicitante|Reclutador|Entrega|Pipeline|Hace 5 h/);
});

it("keeps the legacy plain description escaped and the apply action", () => {
  const { container } = render(<JobDetailView job={{ ...legacyDetail, description_plain: "<script>alert('xss')</script>\n\nOtro párrafo" }} />);
  expect(screen.getByText("<script>alert('xss')</script>")).toBeVisible();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${legacyDetail.id}/postular`);
  expect(screen.queryByRole("heading", { name: "Requisitos" })).toBeNull();
});

it("omits optional vacancy blocks and hidden compensation without placeholders", () => {
  const { container } = render(<JobDetailView job={{ ...vacancyDetail, compensation: null, requirements: { required: null, preferred: null }, benefits: { predefined: [], custom: [] } }} />);
  for (const name of ["Lo que buscamos", "Beneficios para ti"]) expect(screen.queryByRole("heading", { name })).toBeNull();
  expect(screen.getByText("Salario no publicado")).toBeVisible();
  expect(container).not.toHaveTextContent(/Salario a convenir|Sin especificar|Sin seleccionar/);
  expect(container.querySelector("aside")).not.toBeNull();
  expect(screen.getByRole("link", { name: "Postularme" })).toBeVisible();
});

it("keeps long custom benefits readable beside icon tiles, not fixed-height badges", () => {
  const benefit = "Apoyo para estudios de especialización y certificaciones profesionales con acompañamiento del equipo";
  const { container } = render(<JobDetailView job={{ ...vacancyDetail, benefits: { predefined: [], custom: [benefit] } }} />);
  const text = screen.getByText(benefit);
  expect(text.closest("li")).toHaveClass("min-w-0");
  expect(text.closest('[data-slot="badge"]')).toBeNull();
  expect(container.querySelector('#beneficios li svg[aria-hidden="true"]')).not.toBeNull();
});

it("uses only public projection content even when ids match prototype enrichments", () => {
  const { container } = render(<JobsResults query={{}} result={{ ok: true, data: { items: [listItem(legacyDetail), listItem(vacancyDetail)], next_cursor: null } }} />);
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  expect(container).not.toHaveTextContent(/Verificada|Hace 2 h|Hace 5 h/);
  expect(screen.getByText("Habilidades")).toBeVisible();
  expect(screen.getByText("Go")).toBeVisible();
});

describe("v2 filters", () => {
  it("shows contract catalog labels, submits raw values and drops the cursor", () => {
    const query = { work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems", cursor: "old" };
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes?cursor=old" query={query}><p>resultados</p></JobsNavigationIsland>);
    for (const [name, value] of [["Modalidad", "Híbrido"], ["Jornada", "Tiempo completo"], ["Tipo de contrato", "Indefinido"], ["Área profesional", "Tecnología y sistemas"]]) {
      expect(screen.getByRole("combobox", { name })).toHaveTextContent(value);
    }
    for (const label of [/Sueldo mínimo/, /Idioma de trabajo/, /Senioridad/, /Moneda/, /Tipo de empleo/]) expect(screen.queryByLabelText(label)).toBeNull();
    const form = container.querySelector<HTMLFormElement>('form[data-nav-intent="filters"]')!;
    expect(Object.fromEntries(new FormData(form))).toMatchObject({ work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems" });
    fireEvent.submit(form);
    expect(push).toHaveBeenCalledWith("/vacantes?work_mode=hybrid&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems");
  });
  it.each(["work_schedule", "contract_type", "professional_area"])("explains catalog exclusions for %s", (key) => {
    const values = { work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems" };
    const { container } = render(<JobsNavigationIsland routeKey="/vacantes" query={{ [key]: values[key as keyof typeof values] }}><p>resultados</p></JobsNavigationIsland>);
    const note = screen.getByText("Algunas vacantes del catálogo anterior no tienen este dato y no aparecen con este filtro.");
    expect(note).toHaveClass("text-muted-foreground");
    expect(note.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="note"]')).toHaveLength(1);
  });
  it("does not show the exclusion note for text or work mode only", () => {
    render(<JobsNavigationIsland routeKey="/vacantes" query={{ q: "Go", work_mode: "remote" }}><p>resultados</p></JobsNavigationIsland>);
    expect(screen.queryByRole("note")).toBeNull();
    const form = screen.getByRole("form", { name: "Filtros" });
    expect(within(form).getAllByRole("combobox")).toHaveLength(7);
  });
});
