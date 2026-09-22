import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { vacancyPipelineHref } from "./model";
import { NEXO_VACANCIES } from "./prototype-vacancies";
import { VacancyPortfolio } from "./vacancy-portfolio";

const source = readFileSync(join(process.cwd(), "src/features/employer-vacancies/vacancy-portfolio.tsx"), "utf8");
/** Every literal paint a token-only surface must never carry in a class list. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Every class list rendered inside `root`, to prove the surface stays token-only. */
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const renderPortfolio = () => render(<VacancyPortfolio vacancies={NEXO_VACANCIES} />);
const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-vacancy-row]")).map((row) => row.getAttribute("data-pf-vacancy-row"));
const filterButton = (name: RegExp) => screen.getByRole("button", { name });
afterEach(() => cleanup());

describe("VacancyPortfolio summary metrics", () => {
  it("renders four truthful summary cards derived from the model helpers", () => {
    const { container } = renderPortfolio();
    const metric = (key: string) => container.querySelector(`[data-pf-vacancy-metric="${key}"]`) as HTMLElement;
    expect(container.querySelectorAll("[data-pf-vacancy-metric]")).toHaveLength(4);
    // Derived, not hardcoded: 3 active, 1 paused, 30 in process, 2 closed.
    expect(["active", "paused", "in-process", "closed"].map((key) => metric(key).textContent)).toEqual([
      "3Activas", "1Pausadas", "30Candidatos en proceso", "2Cerradas",
    ]);
  });
});

describe("VacancyPortfolio search and status filters", () => {
  it("exposes a labelled search input and four counted status filters", () => {
    const { container } = renderPortfolio();
    expect(screen.getByLabelText("Buscar vacante")).toHaveAttribute("data-pf-vacancy-search");
    const filters = Array.from(container.querySelectorAll("[data-pf-vacancy-filter]")) as HTMLElement[];
    expect(filters.map((filter) => filter.getAttribute("data-pf-vacancy-filter"))).toEqual(["all", "active", "paused", "closed"]);
    expect(filters.map((filter) => filter.textContent)).toEqual(["Todas6", "Activas3", "Pausadas1", "Cerradas2"]);
    expect(filters.map((filter) => filter.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
  });

  it("filters the portfolio by publication state", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    await user.click(filterButton(/Pausadas/));
    expect(rowIds(container)).toEqual(["devops-engineer"]);
    expect(filterButton(/Pausadas/)).toHaveAttribute("aria-pressed", "true");
    await user.click(filterButton(/Cerradas/));
    expect(rowIds(container)).toEqual(["qa-automation-engineer", "data-analyst"]);
    await user.click(filterButton(/^Todas/));
    expect(rowIds(container)).toHaveLength(6);
  });

  it("composes the search term with the selected state, ignoring case", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    const search = screen.getByLabelText("Buscar vacante");
    await user.type(search, "REACT");
    expect(rowIds(container)).toEqual(["frontend-engineer-react"]);
    await user.clear(search);
    await user.type(search, "developer");
    expect(rowIds(container)).toEqual(["backend-developer-senior", "fullstack-developer"]);
    await user.click(filterButton(/Activas/));
    expect(rowIds(container)).toEqual(["backend-developer-senior", "fullstack-developer"]);
    await user.click(filterButton(/Cerradas/));
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector("[data-pf-vacancy-empty]")).not.toBeNull();
  });
});

describe("VacancyPortfolio vacancy rows", () => {
  it("lists all six vacancies with one canonical pipeline link each and no nested control", () => {
    const { container } = renderPortfolio();
    expect(rowIds(container)).toEqual(NEXO_VACANCIES.map((vacancy) => vacancy.id));
    for (const vacancy of NEXO_VACANCIES) {
      const row = container.querySelector(`[data-pf-vacancy-row="${vacancy.id}"]`) as HTMLElement;
      const link = row.querySelector("[data-pf-vacancy-pipeline]") as HTMLAnchorElement;
      expect([row.tagName, row.closest("a"), row.querySelectorAll("a").length, row.querySelectorAll("button").length]).toEqual(["LI", null, 1, 0]);
      expect([link.getAttribute("href"), link.getAttribute("aria-label")]).toEqual([vacancyPipelineHref(vacancy.id), `Ver pipeline de ${vacancy.title}`]);
    }
    expect(container.querySelectorAll("a")).toHaveLength(6);
    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("renders the truthful text and status information of one vacancy", () => {
    const { container } = renderPortfolio();
    const backend = container.querySelector('[data-pf-vacancy-row="backend-developer-senior"]') as HTMLElement;
    for (const value of [
      "Backend Developer (Senior)", "Remoto", "Tiempo completo", "7 candidatos · 5 en proceso", "Activa", "Valeria Ortiz", "9 de marzo de 2026",
      "Nuevos: 3 · En revisión: 2 · Contratados: 1 · Descartados: 1",
    ]) {
      expect(backend).toHaveTextContent(value);
    }
    expect(backend.querySelector("time")).toHaveAttribute("datetime", "2026-03-09T15:00:00Z");
  });
});

describe("VacancyPortfolio empty states", () => {
  it("recovers from an empty result through the keyboard-native clear action", async () => {
    const user = userEvent.setup();
    const { container } = renderPortfolio();
    const search = screen.getByLabelText("Buscar vacante");
    await user.type(search, "sin coincidencias");
    expect(container.querySelector("[data-pf-vacancy-empty]")).not.toBeNull();
    expect(rowIds(container)).toEqual([]);
    const clear = screen.getByRole("button", { name: "Limpiar filtros" });
    expect(clear).toHaveAttribute("data-pf-vacancy-clear");
    await user.click(clear);
    expect(rowIds(container)).toHaveLength(6);
    expect(search).toHaveValue("");
    expect(filterButton(/^Todas/)).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an honest empty portfolio with no clear action when nothing exists", () => {
    const { container } = render(<VacancyPortfolio vacancies={[]} />);
    expect(container.querySelector("[data-pf-vacancy-empty]")).toHaveTextContent("Todavía no hay vacantes");
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(container.querySelectorAll("[data-pf-vacancy-metric]")).toHaveLength(4);
  });

  it("never offers a clear action it cannot fulfil while the portfolio is empty", async () => {
    const user = userEvent.setup();
    const { container } = render(<VacancyPortfolio vacancies={[]} />);
    await user.type(screen.getByLabelText("Buscar vacante"), "algo");
    await user.click(filterButton(/Activas/));
    expect(container.querySelector("[data-pf-vacancy-empty]")).toHaveTextContent("Todavía no hay vacantes");
    expect(rowIds(container)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  });
});

describe("VacancyPortfolio interaction and source contract", () => {
  it("keeps interactive targets at least 40px with visible focus and token-only paint", () => {
    const { container } = renderPortfolio();
    expect(screen.getByLabelText("Buscar vacante").className).toContain("h-10");
    for (const filter of container.querySelectorAll("[data-pf-vacancy-filter]")) {
      const classes = filter.getAttribute("class") ?? "";
      expect([classes.includes("min-h-10"), classes.includes("focus-visible:ring-3")]).toEqual([true, true]);
    }
    const link = container.querySelector("[data-pf-vacancy-pipeline]") as HTMLElement;
    expect([link.className.includes("h-10"), /focus-visible:ring/u.test(link.className), /duration-200/u.test(link.className)]).toEqual([true, true, true]);
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("stays a local in-memory client surface with no request, storage, or business mutation", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toContain("./model");
    for (const forbidden of ["@/features/jobs", "features/jobs", "./prototype-vacancies", "NEXO_VACANCIES", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "onDrag", "draggable", ".css"]) {
      expect(source, `vacancy-portfolio.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});
