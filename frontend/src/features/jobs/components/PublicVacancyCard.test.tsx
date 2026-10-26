import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicVacancyCard } from "./PublicVacancyCard";
import { VacancyCard } from "./VacancyCard";

const NOW = new Date("2026-10-18T12:00:00Z");
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([vacancyDetail, legacyDetail])("uses a company tile and horizontal salary footer for $source without invented data", (detail) => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const { container } = render(<ul><VacancyCard job={listItem(detail)} /></ul>);
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card).not.toHaveClass("md:grid-cols-[minmax(0,1fr)_14rem]");
  expect(card.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("Ac");
  const footer = card.querySelector('[data-slot="card-footer"]')!;
  expect(footer).toHaveClass("border-t", "bg-muted/40", "justify-between");
  expect(within(footer as HTMLElement).getByRole("link", { name: "Ver vacante" })).toHaveClass("bg-primary", "min-h-11");
  expect(footer.querySelector('[data-public-salary]')).not.toBeNull();
  const conditions = screen.getByRole("list", { name: "Condiciones principales" });
  expect(conditions.querySelectorAll('[data-fact]')).toHaveLength(3);
  expect(conditions.querySelector('[data-fact="work_mode"] svg')).not.toBeNull();
  expect(conditions).toHaveTextContent("Ciudad de México");
  if (detail.source === "legacy") expect(container).not.toHaveTextContent(/Indefinido|Tecnología y sistemas|Mensual/);
  expect(container).not.toHaveTextContent(/Destacada|Verificada|Responde/);
  if (detail.source === "vacancy") {
    expect(container).toHaveTextContent("Menos de 10 postulantes");
    expect(container).toHaveTextContent("Postulación rápida");
  } else expect(container).not.toHaveTextContent(/postulantes|Postulación rápida|Habilidades|Beneficios/);
  expect(screen.queryByRole("button", { name: /Guardar/ })).toBeNull();
});

it("keeps condition and secondary fact order without filling absent optional facts", () => {
  const { container, rerender } = render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), seniority: "senior" }} />);
  const conditionKeys = () => [...container.querySelectorAll('[data-public-job-chips] [data-fact]')].map(node => node.getAttribute("data-fact"));
  expect(conditionKeys()).toEqual(["work_mode", "location", "work_schedule"]);
  expect(screen.getByText("Indefinido · Senior · Tecnología y sistemas")).toBeVisible();
  rerender(<PublicVacancyCard job={listItem({ ...legacyDetail, location: null, location_label: null })} />);
  expect(conditionKeys()).toEqual(["work_mode", "legacy_employment_type"]);
  expect(container.querySelector('[data-public-secondary-facts]')).toHaveTextContent("Senior");
  expect(container.querySelector('[data-slot="card-description"]')).not.toHaveTextContent("·");
});

it("uses the reference's quiet initials tile consistently across company names and sources", () => {
  const job = listItem(vacancyDetail);
  const { container, rerender } = render(<PublicVacancyCard job={job} />);
  const fallback = () => container.querySelector('[data-slot="avatar-fallback"]')!;
  const first = fallback().className;
  expect(fallback()).toHaveClass("bg-background", "text-primary", "border");
  expect(first).not.toMatch(/#[0-9a-f]|dark:/i);
  rerender(<PublicVacancyCard job={{ ...listItem(legacyDetail), company: { ...job.company, name: "Otra Empresa" } }} />);
  expect(fallback()).toHaveAttribute("class", first);
  expect(fallback()).toHaveTextContent("OE");
});

it("uses Nueva alone to convey freshness, without a relative-time line or tooltip", () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const { container } = render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), published_at: "2026-10-18T10:00:00Z" }} />);
  expect(container.querySelector("time")).toBeNull();
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(container).not.toHaveTextContent("Hace 2 h");
  expect(screen.getByText("Nueva").closest('[data-slot="card-action"]')).not.toBeNull();
});

it.each([
  ["2026-10-16T12:00:00.001Z", true],
  ["2026-10-16T12:00:00Z", false],
  ["2026-10-18T12:00:01Z", false],
])("marks Nueva only for a nonfuture publication strictly younger than 48 h: %s", (published_at, isNew) => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), published_at }} />);
  expect(screen.queryByText("Nueva") !== null).toBe(isNew);
});

it("hydrates without clock-dependent markup mismatches before mounting the freshness badge", async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const job = { ...listItem(vacancyDetail), published_at: "2026-10-18T10:00:00Z" };
  const html = renderToString(<ul><PublicVacancyCard job={job} /></ul>);
  expect(html).not.toContain("Hace 2 h");
  expect(html).not.toContain(">Nueva<");
  const element = document.createElement("div");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  element.append(...Array.from(parsed.body.childNodes));
  document.body.append(element);
  const onRecoverableError = vi.fn();
  vi.setSystemTime(new Date("2026-10-18T13:00:00Z"));
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(element, <ul><PublicVacancyCard job={job} /></ul>, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(element).toHaveTextContent("Nueva");
  } finally {
    await act(async () => { root?.unmount(); });
    element.remove();
  }
});

it.each([vacancyDetail, legacyDetail])("uses a quiet honest salary absence for $source", (detail) => {
  const job = detail.source === "vacancy" ? { ...listItem(detail), compensation: null } : { ...listItem(detail), legacy_salary: null };
  const { container } = render(<PublicVacancyCard job={job} />);
  expect(screen.getByText("Salario no publicado")).toHaveClass("text-muted-foreground");
  expect(container.querySelector('[data-public-salary]')).toBeNull();
  expect(container).not.toHaveTextContent(/A convenir|Salario a convenir/);
});

it("renders enriched projection content through VacancyCard, safely as text", () => {
  const { container } = render(<VacancyCard job={{ ...listItem(vacancyDetail), excerpt: "<b>Construye servicios</b>" }} />);
  expect(screen.getByText("<b>Construye servicios</b>")).toBeVisible();
  expect(container.querySelector("b")).toBeNull();
  expect(screen.getByText("Habilidades")).toBeVisible();
  expect(screen.getByLabelText("Beneficios")).toBeVisible();
  expect(screen.getByText("Postulación rápida")).toBeVisible();
});

it("leaves no enrichment placeholders for absent legacy content", () => {
  const { container } = render(<PublicVacancyCard job={{ ...listItem(legacyDetail), excerpt: null }} />);
  expect(container.querySelector('[data-slot="separator"]')).toBeNull();
  expect(container).not.toHaveTextContent(/Habilidades|Beneficios|Postulación rápida/);
});
