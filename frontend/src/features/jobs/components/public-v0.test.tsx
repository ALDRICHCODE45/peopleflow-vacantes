import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicVacancyCard } from "./PublicVacancyCard";
import { PublicJobDetailView } from "./PublicJobDetailView";
import { PublicJobCardSkeleton, PublicJobDetailSkeleton } from "./PublicJobSkeleton";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("composes the v0 listing header, conditions, preview links and horizontal footer", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
  const job = { ...listItem(vacancyDetail), published_at: "2026-10-18T10:00:00Z", benefits_total: 5, skills_total: 8, skills_preview: ["Go", "SQL", "Git", "HTTP", "Linux", "Docker"] };
  const { container } = render(<PublicVacancyCard job={job} />);
  expect(container.querySelector('[data-slot="card"]')).toHaveClass("[--card-spacing:--spacing(6)]");
  expect(container.querySelector('[data-slot="avatar"]')).toHaveClass("size-12", "rounded-xl");
  expect(screen.getByRole("heading", { name: job.title })).toHaveClass("text-xl", "font-semibold");
  expect(screen.getByText("Nueva").closest('[data-slot="card-action"]')).not.toBeNull();
  const conditions = screen.getByRole("list", { name: "Condiciones principales" });
  for (const text of ["Híbrido", "Ciudad de México", "Tiempo completo", "Menos de 10 postulantes"]) expect(within(conditions).getByText(text)).toBeVisible();
  expect(conditions.querySelector(".lucide-users")).not.toBeNull();
  expect(screen.getByText("Indefinido · Tecnología y sistemas")).toBeVisible();
  expect(screen.getByText("Habilidades")).toBeVisible();
  expect(screen.getByText("+2")).toBeVisible();
  expect(screen.getByRole("link", { name: "y 3 beneficios más" })).toHaveAttribute("href", `/vacantes/${job.id}#beneficios`);
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector("time")).toBeNull();
  expect(container).not.toHaveTextContent(/Hace |Tecnologías/);
  const footer = container.querySelector('[data-slot="card-footer"]')!;
  expect(footer).toHaveClass("bg-muted/40", "max-[480px]:flex-col");
  expect(within(footer as HTMLElement).getByText("$30,000 – $40,000")).toHaveClass("tabular-nums");
  expect(within(footer as HTMLElement).getByText("Mensual · Bruto")).toBeVisible();
  expect(within(footer as HTMLElement).getByRole("link", { name: "Ver vacante" })).toHaveClass("min-h-11", "bg-primary");
  expect(within(footer as HTMLElement).getByText("Postulación rápida").querySelector(".lucide-zap")).not.toBeNull();
});

it("renders the detail hero, glance facts, data-only anchors and benefits icons", () => {
  const { container } = render(<PublicJobDetailView job={vacancyDetail} />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveClass("sm:text-4xl", "text-balance");
  expect(container.querySelector('[data-slot="avatar"]')).toHaveClass("size-16");
  expect(screen.queryByRole("navigation", { name: "Ruta de navegación" })).toBeNull();
  expect(container.querySelector('[data-slot="public-job-detail"]')?.firstElementChild).toHaveAttribute("data-slot", "card");
  expect(screen.getByText("16 de octubre de 2026", { selector: "time" }).parentElement).toHaveTextContent("Publicada el 16 de octubre de 2026");
  const glance = screen.getByRole("heading", { name: "La vacante de un vistazo" }).closest('[data-slot="card"]')!;
  expect(glance.querySelectorAll("dt")).toHaveLength(5);
  expect(glance).not.toHaveTextContent("Nivel");
  expect(glance.querySelector("dl")).toHaveClass("grid-cols-2", "sm:grid-cols-3");
  const nav = screen.getByRole("navigation", { name: "Secciones de la vacante" });
  for (const [label, id] of [["Descripción", "descripcion"], ["Requisitos", "requisitos"], ["Beneficios", "beneficios"], ["Habilidades", "habilidades"]]) {
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
    expect(container.querySelector(`#${id}`)).not.toBeNull();
  }
  expect(screen.getByRole("heading", { name: "Lo que buscamos" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Requisitos indispensables" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "También valoramos" })).toBeVisible();
  expect(screen.getByText("Experiencia con Go").tagName).toBe("P");
  expect(container.querySelector("#beneficios .lucide-shield-plus")).not.toBeNull();
  expect(container.querySelector("#beneficios .lucide-gift")).not.toBeNull();
  expect(container.querySelector("#habilidades")).toHaveTextContent("GoSQL");
  expect(container.querySelector("aside")).toHaveClass("row-start-1", "lg:col-start-2", "lg:sticky");
  const aside = container.querySelector("aside")!;
  expect(within(aside).getByRole("heading", { name: "¿Te ves en este equipo?" })).toBeVisible();
  expect(aside).toHaveTextContent("Da el siguiente paso en tu carrera con Acme.");
  expect(within(aside).getByRole("link", { name: "Postularme" })).toHaveClass("h-12");
  expect(aside.querySelector('[data-slot="card-footer"]')).toHaveTextContent("Ciudad de México · Híbrido");
});

it("omits unavailable sections and facts for legacy, without inventing payment cadence", () => {
  const { container } = render(<PublicJobDetailView job={{ ...legacyDetail, location: null, location_label: null, description_plain: "" }} />);
  expect(screen.queryByRole("navigation", { name: "Secciones de la vacante" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Sobre la vacante" })).toBeNull();
  const glance = screen.getByRole("heading", { name: "La vacante de un vistazo" }).closest('[data-slot="card"]')!;
  expect(glance).not.toHaveTextContent(/Ubicación|Jornada|Contrato|Área profesional/);
  expect(container).not.toHaveTextContent(/Mensual|Bruto|Neto|preguntas de filtro/);
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${legacyDetail.id}/postular`);
});

it("preserves authored rich lists, ordered starts and paragraph-only requirements", () => {
  const description = { schema_version: 1 as const, document: { type: "doc" as const, content: [
    { type: "bulletList" as const, content: [{ type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Construir servicios" }] }] }] },
    { type: "orderedList" as const, attrs: { start: 3, type: null }, content: [{ type: "listItem" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Revisar el código" }] }] }] },
  ] } };
  const job = { ...vacancyDetail, description, requirements: { required: "Primera línea\nSegunda línea", preferred: null } };
  const view = render(<PublicJobDetailView job={job} />);
  const content = view.container.querySelector(".pf-job-description")!;
  expect(content.querySelector("ul > li")).toHaveTextContent("Construir servicios");
  expect(content.querySelector("ol")).toHaveAttribute("start", "3");
  expect(screen.getByText(/Primera línea/)).toHaveClass("whitespace-pre-wrap");
  expect(screen.queryByRole("heading", { name: "También valoramos" })).toBeNull();
  view.unmount();
  const skeleton = render(<PublicJobDetailSkeleton job={job} />);
  const loadingContent = skeleton.container.querySelector(".pf-job-description")!;
  expect(loadingContent.querySelectorAll("ul > li")).toHaveLength(1);
  expect(loadingContent.querySelector("ol")).toHaveAttribute("start", "3");
});

it.each([true, false])("reports the actual clipboard outcome (success %s)", async (success) => {
  const writeText = success ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<PublicJobDetailView job={vacancyDetail} />);
  fireEvent.click(screen.getByRole("button", { name: "Compartir vacante" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(success ? "Enlace copiado" : "Copia la dirección de esta página para compartirla."));
  expect(writeText).toHaveBeenCalledWith(window.location.href);
});

it.each([vacancyDetail, legacyDetail])("mirrors the redesigned $source slots and major geometry while loading", (job) => {
  const slots = (root: Element) => [...root.querySelectorAll('[data-slot^="card"]')].map(node => node.getAttribute("data-slot"));
  const view = render(<PublicJobDetailView job={job} />);
  const expected = slots(view.container);
  const classes = [...view.container.querySelectorAll('[data-slot="card"]')].map(node => node.className);
  view.unmount();
  const loading = render(<PublicJobDetailSkeleton job={job} />);
  expect(slots(loading.container)).toEqual(expected);
  expect([...loading.container.querySelectorAll('[data-slot="card"]')].map(node => node.className)).toEqual(classes);
  expect(loading.container.querySelector("aside")).toHaveClass("lg:sticky");
  expect(screen.getByRole("status")).toHaveTextContent("Cargando vacante");
  loading.unmount();
  const card = render(<PublicVacancyCard job={listItem(job)} />);
  const expectedCardSlots = slots(card.container);
  card.unmount();
  const skeleton = render(<PublicJobCardSkeleton job={job} />);
  expect(slots(skeleton.container)).toEqual(expectedCardSlots);
  expect(skeleton.container.querySelector('[data-slot="card-footer"]')).toHaveClass("bg-muted/40", "max-[480px]:flex-col");
});
