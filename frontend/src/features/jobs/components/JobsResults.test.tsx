import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  it("keeps the retryable error and exact canonical retry URL", () => {
    render(<JobsResults result={{ ok: false, error: { kind: "status", retryable: true, status: 503 } }} query={{ q: "frontend", contract_type: "indefinite" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las vacantes");
    expect(screen.getByRole("link", { name: "Intentar de nuevo" })).toHaveAttribute("href", "/vacantes?q=frontend&contract_type=indefinite");
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("keeps an Empty state with a reset and no list", () => {
    const { container } = render(<JobsResults result={listOf([])} query={{ q: "react" }} />);
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByText("No hay vacantes")).toBeVisible();
    expect(screen.getByText("No hay vacantes")).toHaveClass("text-xl", "font-semibold");
    expect(screen.getByText(/Quita los filtros para volver a ver/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "Quitar filtros" })).toHaveClass("w-full", "sm:w-auto");
    expect(screen.getByRole("link", { name: "Quitar filtros" })).toHaveAttribute("href", "/vacantes");
    expect(screen.queryByRole("list", { name: "Listado de vacantes" })).toBeNull();
  });
  it("preserves every active filter and opaque cursor on the next link only", () => {
    const query = { q: "Go", location: "CDMX", work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems" };
    const { rerender } = render(<JobsResults result={{ ok: true, data: { items: [listItem(vacancyDetail)], next_cursor: "opaque a+b/c=" } }} query={query} />);
    const link = screen.getByRole("link", { name: "Ver más vacantes" });
    expect(link).toHaveAttribute("href", "/vacantes?q=Go&location=CDMX&work_mode=hybrid&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems&cursor=opaque+a%2Bb%2Fc%3D");
    expect(link).toHaveAttribute("data-jobs-next-link", "true");
    rerender(<JobsResults result={listOf([listItem(vacancyDetail)])} query={query} />);
    expect(screen.queryByRole("link", { name: "Ver más vacantes" })).toBeNull();
  });
  it("stays server-rendered without transport, cache or prototype enrichment", () => {
    const source = readFileSync(join(process.cwd(), "src/features/jobs/components/JobsResults.tsx"), "utf8");
    expect(source).not.toMatch(/use client|\bfetch\s*\(|react-query|useState|useEffect|enrichJob/u);
    expect(source).toContain("./VacancyCard");
  });
});
