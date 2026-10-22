import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { VacancyPortfolio } from "./vacancy-portfolio";
import { usePortfolioDrafts } from "./use-portfolio-drafts";

vi.mock("./use-portfolio-drafts", () => ({ usePortfolioDrafts: vi.fn(), DRAFT_LIST_MESSAGES: {} }));

const candidates = { total: 7, in_process: 5, discarded: 1, by_stage: [
  { id: "new", kind: "new" as const, name: "Nuevos", count: 3 },
  { id: "review", kind: "custom" as const, name: "En revisión", count: 2 },
  { id: "hired", kind: "placement" as const, name: "Contratados", count: 1 },
] };
const base: DraftListRow = {
  id: "backend-real", title: "Ingeniero backend", status: "published", process: "active", candidates,
  work_mode: "remote", work_schedule: "full_time", requester: null,
  principal_recruiter: { id: "recruiter-real", name: "Ana" }, version: "1",
  published_at: "2026-03-09T15:00:00Z", paused_at: null, closed_at: null, process_finished_at: null,
  close_reason: null, close_reason_note: null, created_at: "2026-03-08T15:00:00Z", updated_at: "2026-03-09T15:00:00Z",
};
const items: DraftListRow[] = [
  { ...base, id: "draft-real", title: "Diseñador de producto", status: "draft", process: null, candidates: null, published_at: null },
  base,
  { ...base, id: "frontend-real", title: "Desarrollador React" },
  { ...base, id: "paused-real", title: "Especialista DevOps", status: "paused", paused_at: "2026-03-10T15:00:00Z" },
  { ...base, id: "closed-real", title: "Analista de calidad", status: "closed", process: "finished", closed_at: "2026-03-11T15:00:00Z", process_finished_at: "2026-03-12T15:00:00Z" },
];
const snapshot = (rows = items) => ({ items: rows, pending: false, failure: null, capped: false, retried: false, retry: vi.fn(), published: vi.fn(), lifecycleChanged: vi.fn() });
beforeEach(() => { vi.mocked(usePortfolioDrafts).mockReturnValue(snapshot()); });
afterEach(cleanup);

const source = readFileSync(join(process.cwd(), "src/features/employer-vacancies/vacancy-portfolio.tsx"), "utf8");
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map(node => node.getAttribute("class") ?? "").join(" ");
const renderPortfolio = () => render(<VacancyPortfolio />);
const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-vacancy-row]")).map(row => row.getAttribute("data-pf-vacancy-row"));
const filterButton = (name: RegExp) => screen.getByRole("tab", { name });

describe("VacancyPortfolio summary metrics", () => {
  it("renders five truthful summary cards derived only from authenticated rows", () => {
    const { container } = renderPortfolio();
    const metrics = container.querySelectorAll("[data-pf-vacancy-metric]");
    expect(metrics).toHaveLength(5);
    expect(Array.from(metrics).map(metric => metric.textContent)).toEqual([
      "2Activas", "1Borradores", "1Pausadas", "15Candidatos en proceso", "1Cerradas",
    ]);
  });
});

describe("VacancyPortfolio search and status filters", () => {
  it("exposes a labelled search input and five counted status filters", () => {
    const { container } = renderPortfolio();
    expect(screen.getByLabelText("Buscar vacante")).toHaveAttribute("data-pf-vacancy-search");
    const filters = Array.from(container.querySelectorAll("[data-pf-vacancy-filter]"));
    expect(filters.map(filter => filter.getAttribute("data-pf-vacancy-filter"))).toEqual(["all", "draft", "active", "paused", "closed"]);
    expect(filters.map(filter => filter.textContent)).toEqual(["Todas5", "Borradores1", "Activas2", "Pausadas1", "Cerradas1"]);
    expect(filters.map(filter => filter.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
  });

  it("filters the portfolio by publication state", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    await user.click(filterButton(/Pausadas/));
    expect(rowIds(container)).toEqual(["paused-real"]);
    expect(filterButton(/Pausadas/)).toHaveAttribute("aria-selected", "true");
    await user.click(filterButton(/Cerradas/));
    expect(rowIds(container)).toEqual(["closed-real"]);
    await user.click(filterButton(/Borradores/));
    expect(rowIds(container)).toEqual(["draft-real"]);
    await user.click(filterButton(/^Todas/));
    expect(rowIds(container)).toHaveLength(5);
  });

  it("composes normalized search with the selected state without altering global counts", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    const search = screen.getByLabelText("Buscar vacante");
    await user.type(search, "REACT");
    expect(rowIds(container)).toEqual(["frontend-real"]);
    await user.clear(search);
    await user.type(search, "disenador");
    expect(rowIds(container)).toEqual(["draft-real"]);
    await user.click(filterButton(/Activas/));
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector("[data-pf-vacancy-empty]")).toHaveTextContent("Sin resultados");
    expect(filterButton(/^Todas/)).toHaveTextContent("Todas5");
  });
});

describe("VacancyPortfolio vacancy rows", () => {
  it("lists only real vacancies with a lifecycle action menu and no nested control", () => {
    const { container } = renderPortfolio();
    expect(rowIds(container)).toEqual(items.map(item => item.id));
    for (const item of items) {
      const row = container.querySelector(`[data-pf-vacancy-row="${item.id}"]`) as HTMLElement;
      expect(row.tagName).toBe("LI");
      expect(row.closest("a")).toBeNull();
      const action = within(row).getByRole("button", { name: `Acciones de ${item.title}` });
      expect(action).toHaveAttribute("aria-haspopup", "menu");
      expect(action.querySelector("button, a")).toBeNull();
      expect(within(row).queryAllByRole("link")).toHaveLength(0);
    }
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(5);
  });

  it("separates identity, conditions, pipeline facts and action in stable row zones", () => {
    const { container } = renderPortfolio();
    const row = container.querySelector('[data-pf-vacancy-row="backend-real"]')!;
    expect(Array.from(row.children).map(node => node.getAttribute("data-pf-vacancy-zone"))).toEqual(["identity", "conditions", "complement", "action"]);
    expect(row.children[0]).toHaveTextContent("Ingeniero backend");
    expect(row.children[1]).toHaveTextContent("Remoto · Tiempo completo");
    expect(row.children[1]).toHaveTextContent("Activa");
    expect(row.children[2]).toHaveTextContent("7 candidatos · 5 en proceso");
    expect(row.children[3]).toHaveClass("[&>button]:w-full", "[&>button]:lg:w-auto");
  });

  it("renders real recruiter, publication and candidate data", () => {
    const { container } = renderPortfolio();
    const backend = container.querySelector('[data-pf-vacancy-row="backend-real"]') as HTMLElement;
    for (const value of [
      "Ingeniero backend", "Remoto", "Tiempo completo", "7 candidatos · 5 en proceso", "Activa", "Ana", "9 de marzo de 2026",
      "Nuevos: 3 · En revisión: 2 · Contratados: 1 · Descartados: 1",
    ]) expect(backend).toHaveTextContent(value);
    expect(backend.querySelector("time")).toHaveAttribute("datetime", "2026-03-09T15:00:00Z");
  });
});

describe("VacancyPortfolio publication-state Badges", () => {
  const variants = { draft: "info", published: "accent", paused: "review", closed: "neutral" } as const;
  const labels = { draft: "Borrador", published: "Activa", paused: "Pausada", closed: "Cerrada · Sin motivo registrado" } as const;

  it("maps each real state onto the shared semantic Badge with a decorative dot", () => {
    const { container } = renderPortfolio();
    for (const item of items) {
      const row = container.querySelector(`[data-pf-vacancy-row="${item.id}"]`)!;
      const badge = row.querySelector("[data-slot='badge']") as HTMLElement;
      expect(badge).toHaveAttribute("data-variant", variants[item.status]);
      expect(badge).toHaveAttribute("data-dot");
      expect(badge).toHaveTextContent(labels[item.status]);
      expect(badge.childNodes).toHaveLength(1);
      expect(badge.querySelectorAll("*")).toHaveLength(0);
    }
  });

  it("uses shared Badge variants rather than local tone and dot class maps", () => {
    expect(source).toContain("type BadgeVariant");
    expect(source).toMatch(/STATUS_VARIANT: Readonly<Record<EmployerVacancyState, BadgeVariant>>/u);
    expect(source).not.toContain("STATUS_BADGE");
    expect(source).not.toContain("STATUS_DOT");
    expect(source).not.toContain("border-border bg-secondary text-foreground");
  });
});

describe("VacancyPortfolio empty states", () => {
  it("recovers from an empty result through the keyboard-native clear action", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    const search = screen.getByLabelText("Buscar vacante");
    await user.type(search, "sin coincidencias");
    expect(rowIds(container)).toEqual([]);
    const clear = screen.getByRole("button", { name: "Limpiar filtros" });
    expect(clear).toHaveAttribute("data-pf-vacancy-clear");
    expect(clear).toHaveClass("bg-primary");
    const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
    expect(within(empty).queryAllByRole("link")).toHaveLength(0);
    expect(within(empty).getAllByRole("button")).toEqual([clear]);
    await user.click(clear);
    expect(rowIds(container)).toHaveLength(5);
    expect(search).toHaveValue("");
    expect(filterButton(/^Todas/)).toHaveAttribute("aria-selected", "true");
  });

  it("shows a confirmed empty portfolio and zero counts without duplicating the create action", () => {
    vi.mocked(usePortfolioDrafts).mockReturnValue(snapshot([]));
    const { container } = renderPortfolio();
    const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
    expect(empty).toHaveTextContent("Todavía no hay vacantes");
    expect(empty).toHaveTextContent("Crea tu primera vacante con «Nueva vacante». Se guarda como borrador hasta que la publiques.");
    expect(within(empty).queryAllByRole("link")).toHaveLength(0);
    expect(within(empty).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(Array.from(container.querySelectorAll("[data-pf-vacancy-metric] h3")).map(metric => metric.textContent)).toEqual(["0", "0", "0", "0", "0"]);
  });

  it("can clear active filters even when the confirmed portfolio is empty", async () => {
    vi.mocked(usePortfolioDrafts).mockReturnValue(snapshot([]));
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    await user.type(screen.getByLabelText("Buscar vacante"), "algo");
    await user.click(filterButton(/Activas/));
    expect(container.querySelector("[data-pf-vacancy-empty]")).toHaveTextContent("Todavía no hay vacantes");
    expect(rowIds(container)).toEqual([]);
    const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
    expect(within(empty).queryAllByRole("link")).toHaveLength(0);
    const clear = within(empty).getByRole("button", { name: "Limpiar filtros" });
    expect(within(empty).getAllByRole("button")).toEqual([clear]);
    await user.click(clear);
    expect(screen.getByLabelText("Buscar vacante")).toHaveValue("");
    expect(filterButton(/^Todas/)).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  });
});

describe("VacancyPortfolio interaction and source contract", () => {
  it("keeps interactive targets at least 40px with visible focus and token-only paint", () => {
    const { container } = renderPortfolio();
    expect(screen.getByLabelText("Buscar vacante").className).toContain("h-10");
    for (const filter of container.querySelectorAll("[data-pf-vacancy-filter]")) expect(filter.className).toContain("focus-visible:ring");
    const action = screen.getByRole("button", { name: `Acciones de ${base.title}` });
    expect(action).toHaveClass("h-10");
    expect(action.className).toContain("focus-visible:ring");
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("keeps transport, mutations and the removed prototype row contract outside the client surface", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toContain("./model");
    for (const forbidden of ["./prototype-vacancies", "NEXO_VACANCIES", "type PortfolioVacancy", "type PortfolioDraft", "prototype", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "onDrag", "draggable", ".css"]) {
      expect(source, `vacancy-portfolio.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    expect(source).toContain("export function VacancyPortfolio()");
  });
});
