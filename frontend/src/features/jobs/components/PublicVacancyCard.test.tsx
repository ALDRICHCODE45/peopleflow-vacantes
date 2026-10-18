import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicVacancyCard } from "./PublicVacancyCard";
import { PublicJobCardSkeleton } from "./PublicJobSkeleton";
import { VacancyCard } from "./VacancyCard";

// jsdom has no anchor geometry. Keep the real trigger/provider; replace only popup positioning.
vi.mock("@/components/ui/tooltip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/tooltip")>();
  return { ...actual, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});

const NOW = new Date("2026-10-18T12:00:00Z");
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([vacancyDetail, legacyDetail])("restores two zones and company initials for $source without invented data", (detail) => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const { container } = render(<ul><VacancyCard job={listItem(detail)} /></ul>);
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card).toHaveClass("grid", "md:grid-cols-[minmax(0,1fr)_14rem]");
  expect(card.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("Ac");
  const rail = card.querySelector('[data-slot="card-footer"]')!;
  expect(rail).toHaveClass("border-t", "md:border-t-0", "md:border-l", "md:col-start-2", "md:row-span-2");
  expect(rail).toHaveTextContent(detail.source === "vacancy" ? "Compensación" : "Salario");
  expect(within(rail as HTMLElement).getByRole("link", { name: "Ver vacante" })).toHaveClass("bg-primary", "min-h-10", "w-full");
  expect(rail.querySelector('[data-public-salary]')).not.toBeNull();
  const chips = card.querySelector('[data-public-job-chips]')!;
  expect(chips.querySelectorAll('[data-slot="badge"]')).toHaveLength(detail.source === "vacancy" ? 4 : 3);
  expect(chips.querySelector('[data-fact="work_mode"] svg')).not.toBeNull();
  expect(chips).not.toHaveTextContent("Ciudad de México");
  if (detail.source === "legacy") expect(chips).not.toHaveTextContent(/Indefinido|Tecnología y sistemas|Mensual/);
  expect(container).not.toHaveTextContent(/Destacada|Verificada|Responde/);
  if (detail.source === "vacancy") {
    expect(container).toHaveTextContent("Menos de 10 postulantes");
    expect(container).toHaveTextContent("Postulación rápida");
    expect(card.querySelector('[data-slot="separator"]')).not.toBeNull();
  } else {
    expect(container).not.toHaveTextContent(/postulantes|Postulación rápida|Habilidades|Beneficios/);
    expect(card.querySelector('[data-slot="separator"]')).toBeNull();
  }
  expect(screen.queryByRole("button", { name: /Guardar/ })).toBeNull();
});

it("keeps the specified chip order and never fills absent optional facts", () => {
  const { container, rerender } = render(<PublicVacancyCard job={{ ...listItem(vacancyDetail), seniority: "senior" }} />);
  const chipKeys = () => [...container.querySelectorAll('[data-public-job-chips] [data-fact]')].map(node => node.getAttribute("data-fact"));
  expect(chipKeys()).toEqual(["work_mode", "work_schedule", "contract_type", "seniority", "professional_area"]);
  rerender(<PublicVacancyCard job={listItem({ ...legacyDetail, location: null })} />);
  expect(chipKeys()).toEqual(["work_mode", "legacy_employment_type", "seniority"]);
  const meta = container.querySelector('[data-slot="card-description"]')!;
  expect(meta.querySelector(".lucide-map-pin")).toBeNull();
  expect(meta).not.toHaveTextContent("·");
});

it("uses a stable company-id tone independent of name and vacancy source", () => {
  const job = listItem(vacancyDetail);
  const { container, rerender } = render(<PublicVacancyCard job={job} />);
  const tone = () => container.querySelector('[data-slot="avatar-fallback"]')!.className;
  const first = tone();
  expect(first).toMatch(/bg-(primary|status-)/);
  expect(first).not.toMatch(/#[0-9a-f]|dark:/i);
  rerender(<PublicVacancyCard job={{ ...listItem(legacyDetail), company: { ...job.company, name: "Otra Empresa" } }} />);
  expect(tone()).toBe(first);
  expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("OE");
  const tones = new Set(Array.from({ length: 8 }, (_, id) => {
    rerender(<PublicVacancyCard job={{ ...job, company: { ...job.company, id: String(id) } }} />);
    return tone();
  }));
  expect(tones.size).toBeGreaterThan(1);
});

it("shows relative publication time with the exact date on a keyboard-reachable tooltip and time element", () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const job = { ...listItem(vacancyDetail), published_at: "2026-10-18T10:00:00Z" };
  const { container } = render(<PublicVacancyCard job={job} />);
  const time = screen.getByText("Hace 2 h");
  expect(time).toHaveAttribute("datetime", job.published_at);
  const trigger = time.closest('[data-slot="tooltip-trigger"]')!;
  expect(trigger).toHaveAttribute("tabindex", "0");
  fireEvent.focus(trigger);
  expect(screen.getByRole("tooltip")).toHaveTextContent("18 de octubre de 2026");
  expect(container).toHaveTextContent("Nueva");
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

it("renders an absolute server date first, then hydrates without clock-dependent markup mismatches", async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const job = { ...listItem(vacancyDetail), published_at: "2026-10-18T10:00:00Z" };
  const html = renderToString(<ul><PublicVacancyCard job={job} /></ul>);
  expect(html).toContain("18 de octubre de 2026");
  expect(html).not.toContain("Hace 2 h");
  expect(html).not.toContain(">Nueva<");
  const element = document.createElement("div");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  element.append(...Array.from(parsed.body.childNodes));
  document.body.append(element);
  const onRecoverableError = vi.fn();
  // The browser clock can advance between the server render and hydration.
  vi.setSystemTime(new Date("2026-10-18T13:00:00Z"));
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(element, <ul><PublicVacancyCard job={job} /></ul>, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(element).toHaveTextContent("Hace 3 h");
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
  expect(container.querySelector('[data-slot="separator"]')).not.toBeNull();
  expect(screen.getByText("Habilidades")).toBeVisible();
  expect(screen.getByText("Beneficios")).toBeVisible();
  expect(screen.getByText("Postulación rápida")).toBeVisible();
});

it("leaves no enrichment placeholders or separator for absent legacy content", () => {
  const { container } = render(<PublicVacancyCard job={{ ...listItem(legacyDetail), excerpt: null }} />);
  expect(container.querySelector('[data-slot="separator"]')).toBeNull();
  expect(container).not.toHaveTextContent(/Habilidades|Beneficios|Postulación rápida/);
});

it.each([vacancyDetail, legacyDetail, { ...legacyDetail, legacy_salary: null, location: null }])("mirrors native slots and two-zone geometry for the $source skeleton", (detail) => {
  const job = listItem(detail);
  const loaded = render(<PublicVacancyCard job={job} />);
  const slots = (root: Element) => [...root.querySelectorAll('[data-slot^="card"]')].map(node => node.getAttribute("data-slot"));
  const expectedSlots = slots(loaded.container);
  const chipsCount = loaded.container.querySelectorAll('[data-public-job-chips] [data-slot="badge"]').length;
  const cardClass = loaded.container.querySelector('[data-slot="card"]')!.className;
  const railClass = loaded.container.querySelector('[data-slot="card-footer"]')!.className;
  loaded.unmount();
  const { container } = render(<PublicJobCardSkeleton job={job} />);
  expect(slots(container)).toEqual(expectedSlots);
  expect(container.querySelector('[data-slot="card"]')).toHaveAttribute("class", cardClass);
  expect(container.querySelector('[data-slot="card-footer"]')).toHaveAttribute("class", railClass);
  expect(container.querySelectorAll('[data-public-job-chips] [data-slot="skeleton"]')).toHaveLength(chipsCount);
});
