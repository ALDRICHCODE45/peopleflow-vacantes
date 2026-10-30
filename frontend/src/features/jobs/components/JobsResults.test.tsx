import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const reload = vi.hoisted(() => ({ reloadPage: vi.fn() }));
vi.mock("./reload-page", () => reload);
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import type { PublicJobItem } from "../types";
import { JobsResults } from "./JobsResults";
const listOf = (items: PublicJobItem[]) => ({ ok: true as const, data: { items, next_cursor: null } });
afterEach(cleanup);

describe("JobsResults v2 composition", () => {
  it("keeps wire order and delegates both sources to the same public card", () => {
    const { container } = render(<JobsResults result={listOf([listItem(vacancyDetail), listItem(legacyDetail)])} query={{}} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([vacancyDetail.title, legacyDetail.title]);
    expect(container.querySelectorAll('li > [data-slot="card"]')).toHaveLength(2);
    expect(screen.getByRole("link", { name: vacancyDetail.title })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}`);
    expect(screen.getAllByText("Acme").every((node) => node.closest("a") === null)).toBe(true);
    expect(container).not.toHaveTextContent(/Hace 5 h|Verificada/);
    expect(screen.getByText("Habilidades")).toBeVisible();
    expect(screen.getByText("Go")).toBeVisible();
  });
  it("retries the current search with a full reload, not a client navigation to the same URL", () => {
    reload.reloadPage.mockClear();
    render(<JobsResults result={{ ok: false, error: { kind: "status", retryable: true, status: 503 } }} query={{ q: "frontend", contract_type: "indefinite" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las vacantes");
    // A same-URL client navigation or router.refresh() sometimes received the
    // recovered payload without applying it (e2e, ~15%); a new document always
    // renders the server result.
    expect(screen.queryByRole("link", { name: "Intentar de nuevo" })).toBeNull();
    const retry = screen.getByRole("button", { name: "Intentar de nuevo" });
    fireEvent.click(retry);
    expect(reload.reloadPage).toHaveBeenCalledOnce();
    expect(retry).toBeDisabled();
    expect(screen.getByRole("link", { name: "Ver todas las vacantes" })).toHaveAttribute("href", "/vacantes");
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("keeps an Empty state with a reset and no list", () => {
    const { container } = render(<JobsResults result={listOf([])} query={{ q: "react" }} />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Sin resultados", level: 2 })).toHaveClass("text-xl", "font-semibold");
    expect(screen.getByText("No encontramos vacantes para «react». Limpia los filtros para consultar el catálogo.")).toBeVisible();
    expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
    expect(container.querySelector('.lucide-search-x')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveClass("w-full", "sm:w-auto");
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/vacantes");
    expect(screen.queryByRole("list", { name: "Listado de vacantes" })).toBeNull();
  });
  it.each([{}, { q: "   ", work_mode: [] }])("distinguishes a truly empty catalog: %j", query => {
    const { container } = render(<JobsResults result={listOf([])} query={query} />);
    expect(screen.getByRole("heading", { name: "Todavía no hay vacantes publicadas", level: 2 })).toBeVisible();
    expect(screen.getByText("Las oportunidades aparecerán aquí cuando las empresas las publiquen. No hay ninguna disponible por ahora; puedes volver al inicio de PeopleFlow.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /filtros/i })).toBeNull();
    expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
    expect(container.querySelector('.lucide-briefcase')).not.toBeNull();
  });
  it.each(["", "Diseño"])("names active filters with query %j", q => {
    render(<JobsResults result={listOf([])} query={{ q, work_mode: "remote" }} />);
    expect(screen.getByRole("heading", { name: "Sin resultados", level: 2 })).toBeVisible();
    expect(screen.getByText(q ? "No encontramos vacantes para «Diseño» con la modalidad «Remoto». Limpia los filtros para consultar el catálogo." : "No hay vacantes que coincidan con la modalidad «Remoto». Limpia los filtros para consultar el catálogo.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/vacantes");
  });
  it.each([{}, { q: "Diseño", work_mode: "remote", state: ["09", "14"] }])("recovers an exhausted cursor without claiming catalog emptiness: %j", filters => {
    const { container } = render(<JobsResults result={listOf([])} query={{ ...filters, cursor: "opaque" }} />);
    expect(screen.getByRole("heading", { name: "No hay más vacantes en esta búsqueda", level: 2 })).toBeVisible();
    expect(screen.getByText("Vuelve al inicio de la búsqueda conservando tus filtros.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver al inicio de la búsqueda" })).toHaveAttribute("href", filters.q ? "/vacantes?q=Dise%C3%B1o&state=09&state=14&work_mode=remote" : "/vacantes");
    expect(screen.queryByRole("link", { name: "Limpiar filtros" })).toBeNull();
    expect(container.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
    expect(container.querySelector('.lucide-search-x')).not.toBeNull();
  });
  it("preserves every active filter and opaque cursor on the next link only", () => {
    const query = { q: "Go", state: ["09", "14"], work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems" };
    const { rerender } = render(<JobsResults result={{ ok: true, data: { items: [listItem(vacancyDetail)], next_cursor: "opaque a+b/c=" } }} query={query} />);
    const link = screen.getByRole("link", { name: "Ver más vacantes" });
    expect(link).toHaveAttribute("href", "/vacantes?q=Go&state=09&state=14&work_mode=hybrid&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems&cursor=opaque+a%2Bb%2Fc%3D");
    expect(link).toHaveAttribute("data-jobs-next-link", "true");
    // Punctual pending cue inside the action, shown only while the island marks it busy.
    const spinner = link.querySelector('[data-slot="spinner"]')!;
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).toHaveAttribute("data-icon", "inline-start");
    expect(spinner).toHaveClass("hidden", "group-aria-busy/next:block");
    expect(link).toHaveClass("group/next");
    rerender(<JobsResults result={listOf([listItem(vacancyDetail)])} query={query} />);
    expect(screen.queryByRole("link", { name: "Ver más vacantes" })).toBeNull();
  });
  it("stays server-rendered without transport, cache or prototype enrichment", () => {
    const source = readFileSync(join(process.cwd(), "src/features/jobs/components/JobsResults.tsx"), "utf8");
    expect(source).not.toMatch(/use client|\bfetch\s*\(|react-query|useState|useEffect|enrichJob/u);
    expect(source).toContain("./VacancyCard");
  });
});
