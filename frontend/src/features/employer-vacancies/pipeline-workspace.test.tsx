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
const list = (root: HTMLElement) => root.querySelector("[data-pf-pipeline-list]") as HTMLElement;
const rowIds = (root: Element) => Array.from(root.querySelectorAll("[data-pf-pipeline-row]")).map((node) => node.getAttribute("data-pf-pipeline-row"));
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

describe("PipelineWorkspace view switch", () => {
  it("offers a labelled Vista del pipeline group defaulting to a pressed Tablero", () => {
    renderWorkspace();
    const group = screen.getByRole("group", { name: "Vista del pipeline" });
    const tabs = Array.from(group.querySelectorAll("button"));
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Tablero", "Lista"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(tabs[0].className).toContain("bg-primary");
    expect(tabs[1].className).not.toContain("bg-primary");
    expect(tabs[1].className).toContain("hover:bg-muted");
  });

  it("gives both view buttons 40px targets, visible focus, and distinct column and list icons", () => {
    renderWorkspace();
    const icons = Array.from(screen.getByRole("group", { name: "Vista del pipeline" }).querySelectorAll("button")).map((tab) => {
      expect(tab.className).toContain("h-10");
      expect(tab.className).toContain("focus-visible:ring-3");
      const icon = tab.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      return icon?.outerHTML ?? "";
    });
    expect(icons[0]).not.toEqual(icons[1]);
  });

  it("switches to the list representation and back while hiding the inactive view", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-pf-pipeline-board]")).not.toBeNull();
    expect(list(container)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(container.querySelector("[data-pf-pipeline-board]")).toBeNull();
    expect(list(container)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tablero" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Tablero" }));
    expect(container.querySelector("[data-pf-pipeline-board]")).not.toBeNull();
    expect(list(container)).toBeNull();
    expect(screen.getByRole("button", { name: "Tablero" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PipelineWorkspace list mode over the filtered set", () => {
  it("lists the exact same candidate inventory, once each, in the filtered order", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const boardInventory = cardIds(container).slice().sort();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const rows = rowIds(container);
    expect(rows).toEqual(backendCandidates.map((candidate) => candidate.id));
    expect(rows.slice().sort()).toEqual(boardInventory);
    expect(new Set(rows).size).toBe(backendCandidates.length);
  });

  it("reuses the live search filter without a divergent candidate set", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Buscar candidato"), "postgres");
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(rowIds(container)).toEqual(["lucia-fernandez", "diego-salazar"]);
    expect(container.querySelectorAll("[data-pf-pipeline-search]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-pf-pipeline-list]")).toHaveLength(1);
  });

  it("renders the truthful facts and visible status text of each row", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const lucia = container.querySelector('[data-pf-pipeline-row="lucia-fernandez"]') as HTMLElement;
    for (const value of ["Lucía Fernández", "Backend Developer Senior", "Nuevos", "8 años", "Node.js", "PostgreSQL", "88%", "LinkedIn", "Valeria Ortiz", "Sin comentarios", "Coordinar llamada inicial"]) {
      expect(lucia).toHaveTextContent(value);
    }
    expect(container.querySelector('[data-pf-pipeline-row="renata-vargas"]')).toHaveTextContent("Contratados");
    expect(container.querySelector('[data-pf-pipeline-row="diego-salazar"]')).toHaveTextContent("4 comentarios");
    expect(container.querySelector('[data-pf-pipeline-next-step="diego-salazar"]')).toHaveTextContent("Agendar entrevista técnica");
    expect(container.querySelector('[data-pf-pipeline-next-step="renata-vargas"]')).toBeNull();
  });

  it("keeps the search query and filtered rows across both modes", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const search = screen.getByLabelText("Buscar candidato");
    await user.type(search, "postgres");
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(search).toHaveValue("postgres");
    expect(rowIds(container)).toEqual(["lucia-fernandez", "diego-salazar"]);
    await user.click(screen.getByRole("button", { name: "Tablero" }));
    expect(search).toHaveValue("postgres");
    expect(cardIds(container).slice().sort()).toEqual(["diego-salazar", "lucia-fernandez"]);
  });

  it("keeps the shared empty-search recovery honest in list mode", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Buscar candidato"), "zzz");
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector("[data-pf-pipeline-list-empty]")).toHaveTextContent("Sin candidatos que coincidan con la búsqueda.");
    expect(container.querySelector("[data-pf-pipeline-recovery]")).not.toBeNull();
    await user.click(container.querySelector("[data-pf-pipeline-clear]") as HTMLElement);
    expect(screen.getByLabelText("Buscar candidato")).toHaveValue("");
    expect(rowIds(container)).toHaveLength(4);
  });

  it("contains narrow-screen overflow in the list region and keeps every row non-interactive", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const region = list(container);
    expect(region.className).toContain("overflow-x-auto");
    expect(region.getAttribute("role")).toBe("region");
    expect(region).toHaveAttribute("tabindex", "0");
    const table = region.querySelector("table") as HTMLElement;
    expect(/min-w-\[/u.test(table.className)).toBe(true);
    for (const row of region.querySelectorAll("[data-pf-pipeline-row]")) {
      expect(row.tagName).toBe("TR");
      expect(row.querySelectorAll("a, button, input, [role='button']")).toHaveLength(0);
      expect(row.hasAttribute("draggable")).toBe(false);
      expect(row.hasAttribute("style")).toBe(false);
    }
  });

  it("states the sample copy and local-only boundary identically in list mode", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(container.querySelector("[data-pf-pipeline-sample]")).toHaveTextContent(visibleCandidatesCopy(4, vacancyCandidateTotal(backend.candidateCounts)));
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-pipeline-card]")).toHaveLength(0);
  });
  it("shows an honest empty-vacancy list without inventing a clear action", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace(backend, []);
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector("[data-pf-pipeline-list-empty]")).toHaveTextContent("Sin candidatos en esta vacante.");
    expect(container.querySelector("[data-pf-pipeline-clear]")).toBeNull();
    expect(container.querySelector("[data-pf-pipeline-sample]")).toHaveTextContent(visibleCandidatesCopy(0, vacancyCandidateTotal(backend.candidateCounts)));
  });

  it("keeps singular experience and comment agreement inside list rows", async () => {
    const user = userEvent.setup();
    const candidate: PipelineCandidate = { ...backendCandidates[0], id: "single-unit", yearsOfExperience: 1, commentCount: 1 };
    const { container } = renderWorkspace(backend, [candidate]);
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const row = container.querySelector('[data-pf-pipeline-row="single-unit"]') as HTMLElement;
    expect(row.textContent).toContain("1 año de experiencia");
    expect(row.textContent).not.toContain("1 años");
    expect(row.textContent).toContain("1 comentario");
    expect(row.textContent).not.toContain("1 comentarios");
  });
});

describe("PipelineWorkspace view switch boundary", () => {
  it("keeps the mode switch purely local UI state over a single filtered source", () => {
    expect(source.match(/const filtered = /gu)).toHaveLength(1);
    expect(source.match(/data-pf-pipeline-search/gu)).toHaveLength(1);
    for (const forbidden of ["window.history", "URLSearchParams", "location.search", "useSearchParams", "pushState", "replaceState"]) {
      expect(source, `pipeline-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
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
