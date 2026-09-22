import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { VACANCY_PIPELINE_STAGES, vacancyCandidateTotal } from "./model";
import type { EmployerVacancy, VacancyPipelineStage } from "./model";
import { CANDIDATE_STATUS_LABELS, visibleCandidatesCopy } from "./pipeline-model";
import type { PipelineCandidate } from "./pipeline-model";
import { NEXO_CANDIDATES } from "./prototype-candidates";
import { NEXO_VACANCIES } from "./prototype-vacancies";
import { PipelineWorkspace } from "./pipeline-workspace";

const source = readFileSync(join(process.cwd(), "src/features/employer-vacancies/pipeline-workspace.tsx"), "utf8");
/** Every literal paint a token-only surface must never carry in a class list. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Every class list rendered inside `root`, to prove the surface stays token-only. */
const classesOf = (root: Element) => Array.from(root.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
const backend = NEXO_VACANCIES.find((vacancy) => vacancy.id === "backend-developer-senior") as EmployerVacancy;
const backendCandidates = NEXO_CANDIDATES.filter((candidate) => candidate.vacancyId === backend.id);
const renderWorkspace = (vacancy: EmployerVacancy = backend, candidates: readonly PipelineCandidate[] = backendCandidates) =>
  render(<PipelineWorkspace vacancy={vacancy} candidates={candidates} />);
const column = (root: HTMLElement, stage: VacancyPipelineStage) => root.querySelector(`[data-pf-pipeline-column="${stage}"]`) as HTMLElement;
const cardIds = (root: Element) => Array.from(root.querySelectorAll("[data-pf-pipeline-card]")).map((node) => node.getAttribute("data-pf-pipeline-card"));
const cardIdsIn = (root: HTMLElement, stage: VacancyPipelineStage) => cardIds(column(root, stage));
afterEach(() => cleanup());

describe("PipelineWorkspace board structure", () => {
  it("always renders the four contract columns in order with filtered counts", () => {
    const { container } = renderWorkspace();
    const columns = Array.from(container.querySelectorAll("[data-pf-pipeline-column]"));
    expect(columns.map((node) => node.getAttribute("data-pf-pipeline-column"))).toEqual([...VACANCY_PIPELINE_STAGES]);
    expect(columns.map((node) => node.getAttribute("data-pf-pipeline-column"))).toEqual(["submitted", "in_review", "hired", "rejected"]);
    for (const stage of VACANCY_PIPELINE_STAGES) {
      expect(column(container, stage)).toHaveTextContent(CANDIDATE_STATUS_LABELS[stage]);
      expect(container.querySelector(`[data-pf-pipeline-column-count="${stage}"]`)).toHaveTextContent("1");
    }
  });

  it("shows every candidate exactly once, each in its own status column", () => {
    const { container } = renderWorkspace();
    expect(cardIds(container).sort()).toEqual(backendCandidates.map((candidate) => candidate.id).sort());
    expect(cardIdsIn(container, "submitted")).toEqual(["lucia-fernandez"]);
    expect(cardIdsIn(container, "in_review")).toEqual(["diego-salazar"]);
    expect(cardIdsIn(container, "hired")).toEqual(["renata-vargas"]);
    expect(cardIdsIn(container, "rejected")).toEqual(["martin-bustos"]);
    expect(new Set(cardIds(container)).size).toBe(cardIds(container).length);
  });

  it("keeps the board scroll contained with a bounded inner grid", () => {
    const { container } = renderWorkspace();
    const board = container.querySelector("[data-pf-pipeline-board]") as HTMLElement;
    const grid = container.querySelector("[data-pf-pipeline-grid]") as HTMLElement;
    expect(board.className).toContain("overflow-x-auto");
    expect(grid.className).toContain("grid-cols-4");
    expect(/min-w-\[/u.test(grid.className)).toBe(true);
    expect(/lg:min-w-0/u.test(grid.className)).toBe(true);
    expect(grid.parentElement).toBe(board);
  });
});

describe("PipelineWorkspace candidate cards", () => {
  it("renders the truthful facts of a card with skills, match, source, owner, and comments", () => {
    const { container } = renderWorkspace();
    const card = container.querySelector('[data-pf-pipeline-card="lucia-fernandez"]') as HTMLElement;
    for (const value of ["Lucía Fernández", "Backend Developer Senior", "8 años", "Node.js", "PostgreSQL", "88%", "LinkedIn", "Valeria Ortiz", "Sin comentarios", "Coordinar llamada inicial"]) {
      expect(card).toHaveTextContent(value);
    }
    expect(card.querySelectorAll("li")).toHaveLength(2);
  });

  it("only renders a next step when the candidate has one", () => {
    const { container } = renderWorkspace();
    expect(container.querySelector('[data-pf-pipeline-next-step="diego-salazar"]')).toHaveTextContent("Agendar entrevista técnica");
    expect(container.querySelector('[data-pf-pipeline-next-step="renata-vargas"]')).toBeNull();
  });

  it("keeps every card a non-interactive article without drag or mutation affordances", () => {
    const { container } = renderWorkspace();
    for (const card of container.querySelectorAll("[data-pf-pipeline-card]")) {
      expect([card.tagName, card.getAttribute("role"), card.getAttribute("tabindex"), card.hasAttribute("draggable")]).toEqual(["ARTICLE", null, null, false]);
      expect(card.querySelectorAll("button, a, input, [role='button']")).toHaveLength(0);
    }
  });
});

describe("PipelineWorkspace local search", () => {
  it("exposes a labelled search input with a visible focus ring", () => {
    renderWorkspace();
    const search = screen.getByLabelText("Buscar candidato");
    expect(search).toHaveAttribute("data-pf-pipeline-search");
    expect(search.className).toContain("h-10");
    expect(search.className).toContain("focus-visible:ring-3");
  });

  it("filters by name and title, ignoring case and diacritics", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const search = screen.getByLabelText("Buscar candidato");
    await user.type(search, "lucia");
    expect(cardIds(container)).toEqual(["lucia-fernandez"]);
    await user.clear(search);
    await user.type(search, "ARQUITECTA");
    expect(cardIds(container)).toEqual(["renata-vargas"]);
  });

  it("filters by skill and keeps all four columns present with filtered counts", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Buscar candidato"), "postgres");
    expect(cardIds(container).sort()).toEqual(["diego-salazar", "lucia-fernandez"]);
    expect(container.querySelectorAll("[data-pf-pipeline-column]")).toHaveLength(4);
    expect(container.querySelector('[data-pf-pipeline-column-count="submitted"]')).toHaveTextContent("1");
    expect(container.querySelector('[data-pf-pipeline-column-count="hired"]')).toHaveTextContent("0");
    expect(column(container, "hired")).toHaveTextContent("Sin candidatos en esta etapa");
  });
});

describe("PipelineWorkspace sample copy and empty recovery", () => {
  it("states the visible sample honestly against the vacancy counters", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const sample = container.querySelector("[data-pf-pipeline-sample]") as HTMLElement;
    expect(sample).toHaveTextContent(visibleCandidatesCopy(4, vacancyCandidateTotal(backend.candidateCounts)));
    expect(sample.textContent).toMatch(/demostración/u);
    await user.type(screen.getByLabelText("Buscar candidato"), "lucia");
    expect(sample).toHaveTextContent(visibleCandidatesCopy(1, 7));
  });

  it("recovers an empty search with a native clear button only when a query hides every card", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-pf-pipeline-clear]")).toBeNull();
    const search = screen.getByLabelText("Buscar candidato");
    await user.type(search, "zzz");
    expect(cardIds(container)).toEqual([]);
    expect(container.querySelectorAll("[data-pf-pipeline-column]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-pf-pipeline-column-empty]")).toHaveLength(4);
    const clear = container.querySelector("[data-pf-pipeline-clear]") as HTMLElement;
    expect([clear.tagName, clear.className.includes("h-10"), clear.className.includes("focus-visible:ring")]).toEqual(["BUTTON", true, true]);
    expect(container.querySelector("[data-pf-pipeline-recovery]")).not.toBeNull();
    await user.click(clear);
    expect(cardIds(container)).toHaveLength(4);
    expect(search).toHaveValue("");
  });

  it("never offers a clear action for an empty vacancy and keeps honest column states", () => {
    const { container } = renderWorkspace(backend, []);
    expect(container.querySelectorAll("[data-pf-pipeline-column-empty]")).toHaveLength(4);
    expect(container.querySelector("[data-pf-pipeline-clear]")).toBeNull();
    expect(container.querySelector("[data-pf-pipeline-sample]")).toHaveTextContent(visibleCandidatesCopy(0, 7));
  });
});

describe("PipelineWorkspace Spanish count agreement", () => {
  it("uses the singular for one year of experience and one comment", () => {
    const candidate: PipelineCandidate = { ...backendCandidates[0], id: "single-unit", yearsOfExperience: 1, commentCount: 1 };
    const { container } = renderWorkspace(backend, [candidate]);
    const card = container.querySelector('[data-pf-pipeline-card="single-unit"]') as HTMLElement;
    expect(card.textContent).toContain("1 año de experiencia");
    expect(card.textContent).not.toContain("1 años");
    expect(card.textContent).toContain("1 comentario");
    expect(card.textContent).not.toContain("1 comentarios");
  });

  it("keeps plural years and comments and the zero-comment copy", () => {
    const { container } = renderWorkspace();
    const lucia = container.querySelector('[data-pf-pipeline-card="lucia-fernandez"]') as HTMLElement;
    const diego = container.querySelector('[data-pf-pipeline-card="diego-salazar"]') as HTMLElement;
    expect(diego.textContent).toContain("6 años de experiencia");
    expect(diego.textContent).toContain("4 comentarios");
    expect(lucia.textContent).toContain("Sin comentarios");
  });

  it("counts a one-candidate column in the singular and a multi-candidate column in the plural", () => {
    const single = renderWorkspace();
    for (const [stage, label] of [["submitted", "Nuevos"], ["in_review", "En revisión"], ["hired", "Contratados"], ["rejected", "Descartados"]] as const) {
      expect(column(single.container, stage)).toHaveAttribute("aria-label", `${label}: 1 candidato`);
    }
    cleanup();
    const pair: readonly PipelineCandidate[] = [backendCandidates[0], { ...backendCandidates[0], id: "second-unit" }];
    const multiple = renderWorkspace(backend, pair);
    expect(column(multiple.container, "submitted")).toHaveAttribute("aria-label", "Nuevos: 2 candidatos");
    expect(multiple.container.querySelector('[data-pf-pipeline-column-count="submitted"]')).toHaveTextContent("2");
  });
});

describe("PipelineWorkspace surface contract", () => {
  it("paints with semantic tokens only and never with inline styles", () => {
    const { container } = renderWorkspace();
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelector("[data-pf-pipeline-board]")?.getAttribute("class") ?? "").toMatch(/focus-visible:ring/u);
  });

  it("stays a local read-only client surface with no fixture import or side effect", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    expect(source).toContain("./pipeline-model");
    expect(source).toContain("./model");
    for (const forbidden of ["@/features/jobs", "features/jobs", "./prototype-candidates", "NEXO_CANDIDATES", "prototype-vacancies", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "onDrag", "onDrop", "draggable", ".css"]) {
      expect(source, `pipeline-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});
