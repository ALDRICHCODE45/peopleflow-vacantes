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
const slot = (root: Element, name: string) => root.querySelector(`[data-slot="${name}"]`) as HTMLElement;
const STATUS_TONES = { submitted: "status-info", in_review: "status-review", hired: "status-success", rejected: "status-danger" } as const;
const STAGE_VARIANTS = { submitted: "info", in_review: "review", hired: "success", rejected: "danger" } as const;
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
      const count = container.querySelector(`[data-pf-pipeline-column-count="${stage}"]`) as HTMLElement;
      expect(count).toHaveTextContent("1");
      expect(count).toHaveAttribute("data-slot", "badge");
      expect(count).toHaveAttribute("data-variant", STAGE_VARIANTS[stage]);
      expect(count.className).toContain(STATUS_TONES[stage]);
      expect(RAW_COLOR.test(count.className)).toBe(false);
      // A stage count is a counter, not a status, so it never takes the dot.
      expect(count).not.toHaveAttribute("data-dot");
      expect(count.className).not.toContain("before:");
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
    const badges = Array.from(card.querySelectorAll("[data-slot='badge']"));
    for (const value of ["Node.js", "PostgreSQL", "88%"]) expect(badges.some((node) => node.textContent?.includes(value))).toBe(true);
  });

  it("keeps match scores, skills and stage counters dotless while only status labels carry the dot", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const card = container.querySelector('[data-pf-pipeline-card="lucia-fernandez"]') as HTMLElement;
    const badges = Array.from(card.querySelectorAll("[data-slot='badge']"));
    const score = badges.find((node) => node.textContent?.includes("88%")) as HTMLElement;
    expect(score).toHaveAttribute("data-variant", STAGE_VARIANTS.submitted);
    expect(score).not.toHaveAttribute("data-dot");
    expect(score.className).not.toContain("before:");
    for (const skill of ["Node.js", "PostgreSQL"]) {
      const chip = badges.find((node) => node.textContent === skill) as HTMLElement;
      expect(chip, skill).toHaveAttribute("data-variant", "outline");
      expect(chip).not.toHaveAttribute("data-dot");
    }
    for (const stage of VACANCY_PIPELINE_STAGES) {
      const count = container.querySelector(`[data-pf-pipeline-column-count="${stage}"]`) as HTMLElement;
      expect(count, stage).not.toHaveAttribute("data-dot");
    }
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const listScore = Array.from(container.querySelectorAll('[data-pf-pipeline-row] [data-slot="badge"]')).find((node) => node.textContent?.includes("88%")) as HTMLElement;
    expect(listScore).toHaveAttribute("data-variant", "outline");
    expect(listScore).not.toHaveAttribute("data-dot");
  });

  it("keeps the column-heading stage marker as a non-Badge dot outside the migrated labels", () => {
    const { container } = renderWorkspace();
    for (const stage of VACANCY_PIPELINE_STAGES) {
      const marker = column(container, stage).querySelector("header [aria-hidden='true']") as HTMLElement;
      expect(marker, stage).not.toBeNull();
      expect(marker.getAttribute("data-slot")).toBeNull();
      expect(marker.className).toContain(STATUS_TONES[stage]);
    }
  });

  it("replaces the duplicated stage tone recipe with the typed semantic variant map", () => {
    expect(source).toContain("type BadgeVariant");
    expect(source).toMatch(/STAGE_VARIANT: Readonly<Record<VacancyPipelineStage, BadgeVariant>>/u);
    expect(source).toContain("<Badge variant={STAGE_VARIANT[candidate.status]} dot");
    expect(source).not.toContain("STAGE_TONE");
    for (const token of Object.values(STATUS_TONES)) expect(source, token).not.toContain(`border-${token}/40`);
  });

  it("only renders a next step when the candidate has one", () => {
    const { container } = renderWorkspace();
    expect(container.querySelector('[data-pf-pipeline-next-step="diego-salazar"]')).toHaveTextContent("Agendar entrevista técnica");
    expect(container.querySelector('[data-pf-pipeline-next-step="renata-vargas"]')).toBeNull();
  });

  it("keeps every candidate root a non-interactive, non-draggable shadcn Card with the full hierarchy, an initials Avatar and Badge chips", () => {
    const { container } = renderWorkspace();
    const initials: Readonly<Record<string, string>> = { "lucia-fernandez": "LF", "diego-salazar": "DS", "renata-vargas": "RV", "martin-bustos": "MB" };
    for (const candidate of backendCandidates) {
      const card = container.querySelector(`[data-pf-pipeline-card="${candidate.id}"]`) as HTMLElement;
      expect([card.getAttribute("data-slot"), card.getAttribute("role"), card.getAttribute("tabindex"), card.hasAttribute("draggable")]).toEqual(["card", null, null, false]);
      for (const part of ["card-header", "card-title", "card-content", "card-footer"]) expect(slot(card, part), part).not.toBeNull();
      expect(card.querySelector("[data-slot='card-title'] h3")).toHaveTextContent(candidate.fullName);
      expect(slot(card, "avatar-fallback")).toHaveTextContent(initials[candidate.id]);
      const badges = Array.from(card.querySelectorAll("[data-slot='badge']"));
      expect(badges.some((node) => node.textContent?.includes(`${candidate.matchScore}%`))).toBe(true);
      for (const skill of candidate.skills.slice(0, 4)) expect(badges.some((node) => node.textContent === skill)).toBe(true);
      expect(card.querySelectorAll("button, a, input, [role='button']")).toHaveLength(0);
    }
  });
});

describe("PipelineWorkspace local search", () => {
  it("composes the search from one labelled shadcn InputGroup with a functional icon and a 40px target", () => {
    const { container } = renderWorkspace();
    const group = container.querySelector("[data-slot='input-group']") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute("role", "group");
    expect(group.className).toContain("h-10");
    const control = group.querySelector("[data-slot='input-group-control']") as HTMLElement;
    expect(control.tagName).toBe("INPUT");
    expect(control).toHaveAttribute("data-pf-pipeline-search");
    expect(screen.getByLabelText("Buscar candidato")).toBe(control);
    expect(group.querySelector("svg"), "functional search icon").not.toBeNull();
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
  it("states the visible candidate count against the vacancy counters", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const sample = container.querySelector("[data-pf-pipeline-sample]") as HTMLElement;
    expect(sample).toHaveTextContent(visibleCandidatesCopy(4, vacancyCandidateTotal(backend.candidateCounts)));
    expect(sample.textContent).not.toMatch(/demostración|prototipo|vista de/iu);
    await user.type(screen.getByLabelText("Buscar candidato"), "lucia");
    expect(sample).toHaveTextContent(visibleCandidatesCopy(1, 7));
    expect(sample.textContent).not.toMatch(/demostración|prototipo|vista de/iu);
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
  it("exposes a labelled shadcn ToggleGroup with exactly two ordered view items defaulting to Tablero", () => {
    const { container } = renderWorkspace();
    const group = container.querySelector("[data-slot='toggle-group']") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAccessibleName("Vista del pipeline");
    expect(group).toHaveAttribute("data-variant", "outline");
    expect(group).toHaveAttribute("data-spacing", "0");
    const tabs = Array.from(group.querySelectorAll("[data-slot='toggle-group-item']")) as HTMLElement[];
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.getAttribute("data-pf-pipeline-view-tab"))).toEqual(["board", "list"]);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Tablero", "Lista"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });

  it("gives both view items 40px targets, visible focus, and distinct column and list icons", () => {
    renderWorkspace();
    const group = screen.getByRole("group", { name: "Vista del pipeline" });
    const icons = Array.from(group.querySelectorAll("[data-slot='toggle-group-item']")).map((tab) => {
      expect(tab.className).toContain("h-10");
      expect(tab.className).toContain("focus-visible:ring");
      const icon = tab.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      return icon?.outerHTML ?? "";
    });
    expect(icons[0]).not.toEqual(icons[1]);
  });

  it("never leaves the controlled group without a selected view when the active item is re-clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    const [board, listTab] = Array.from(container.querySelectorAll("[data-slot='toggle-group-item']")) as HTMLElement[];
    await user.click(board);
    expect([board, listTab].map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(container.querySelector("[data-pf-pipeline-board]")).not.toBeNull();
    await user.click(listTab);
    await user.click(listTab);
    expect([board, listTab].map((tab) => tab.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(container.querySelector("[data-pf-pipeline-list]")).not.toBeNull();
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
    const statusBadge = Array.from(lucia.querySelectorAll("[data-slot='badge']")).find((node) => node.textContent === CANDIDATE_STATUS_LABELS.submitted);
    expect(statusBadge).not.toBeNull();
    expect(statusBadge).toHaveAttribute("data-variant", STAGE_VARIANTS.submitted);
    expect(statusBadge).toHaveAttribute("data-dot");
    expect(statusBadge?.className).toContain(STATUS_TONES.submitted);
    // The dot is the shared recipe's `::before`, never a manually rendered child.
    expect(statusBadge?.childNodes).toHaveLength(1);
    expect(statusBadge?.querySelectorAll("*")).toHaveLength(0);
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
    for (const name of ["table", "table-header", "table-body", "table-row", "table-head", "table-cell"]) expect(slot(region, name), name).not.toBeNull();
    expect(slot(region, "table").tagName).toBe("TABLE");
    for (const row of region.querySelectorAll("[data-pf-pipeline-row]")) {
      expect(row.tagName).toBe("TR");
      expect(row).toHaveAttribute("data-slot", "table-row");
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
    expect(container.querySelector("[data-pf-pipeline-sample]")?.textContent).not.toMatch(/demostración|prototipo|vista de/iu);
    const styled = Array.from(container.querySelectorAll("[style]"));
    expect(styled).toHaveLength(1);
    expect(styled[0]).toHaveAttribute("data-slot", "toggle-group");
    expect(styled[0].getAttribute("style")).toMatch(/^--gap:\s*0;?$/u);
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

describe("PipelineWorkspace shadcn empty states", () => {
  it("renders board-column, list and recovery empties through the shadcn Empty hierarchy with bounded padding", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace(backend, []);
    for (const marker of Array.from(container.querySelectorAll("[data-pf-pipeline-column-empty]"))) {
      const empty = (marker.matches("[data-slot='empty']") ? marker : marker.querySelector("[data-slot='empty']")) as HTMLElement;
      expect(empty, "column empty uses shadcn Empty").not.toBeNull();
      expect(empty).toHaveTextContent("Sin candidatos en esta etapa.");
      expect(empty.className).toMatch(/(?:^|\s)p-\d/u);
      expect(empty.className).not.toContain("p-12");
    }
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const listEmpty = container.querySelector("[data-pf-pipeline-list-empty]") as HTMLElement;
    expect(listEmpty.matches("[data-slot='empty']") ? listEmpty : listEmpty.querySelector("[data-slot='empty']")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Tablero" }));
    await user.type(screen.getByLabelText("Buscar candidato"), "zzz");
    const recovery = container.querySelector("[data-pf-pipeline-recovery]") as HTMLElement;
    const empty = (recovery.matches("[data-slot='empty']") ? recovery : recovery.querySelector("[data-slot='empty']")) as HTMLElement;
    expect(empty, "recovery uses shadcn Empty").not.toBeNull();
    for (const part of ["empty-header", "empty-title", "empty-description", "empty-content"]) expect(slot(empty, part), part).not.toBeNull();
    expect(empty.className).toMatch(/(?:^|\s)p-\d/u);
    expect(empty.className).not.toContain("p-12");
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
  it("paints with semantic tokens only and allows just the ToggleGroup --gap style", () => {
    const { container } = renderWorkspace();
    expect(RAW_COLOR.test(classesOf(container))).toBe(false);
    const styled = Array.from(container.querySelectorAll("[style]"));
    expect(styled).toHaveLength(1);
    expect(styled[0]).toHaveAttribute("data-slot", "toggle-group");
    expect(styled[0].getAttribute("style")).toMatch(/^--gap:\s*0;?$/u);
    expect(container.querySelector("[data-pf-pipeline-board]")?.getAttribute("class") ?? "").toMatch(/focus-visible:ring/u);
  });

  it("stays a local read-only client surface over only the approved shadcn modules and no side effect", () => {
    expect(source).toMatch(/^\s*["']use client["']/mu);
    const modules = [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    expect(modules).toEqual([
      "./model", "./pipeline-model",
      "@/components/ui/avatar", "@/components/ui/badge", "@/components/ui/button", "@/components/ui/card",
      "@/components/ui/empty", "@/components/ui/input-group", "@/components/ui/table", "@/components/ui/toggle-group",
      "lucide-react", "react",
    ].sort());
    for (const raw of ['@/components/ui/input"', "@/lib/utils", "cn("]) {
      expect(source, `pipeline-workspace.tsx must not import ${raw}`).not.toContain(raw);
    }
    for (const forbidden of ["@/features/jobs", "features/jobs", "./prototype-candidates", "NEXO_CANDIDATES", "prototype-vacancies", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.clipboard", "useRouter", "next/navigation", "onDrag", "onDrop", "draggable", ".css"]) {
      expect(source, `pipeline-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("PipelineWorkspace EPR-05 visual correction", () => {
  it("keeps the focusable list region the only horizontal scroll owner and stops truncating card identity", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Lista" }));
    const region = list(container);
    expect.soft(region.querySelector(":scope > [data-slot='table-container']"), "list owns the shadcn table-container box").not.toBeNull();
    expect.soft(region.className, "list owns the wide scroll").toContain("overflow-x-auto");
    expect.soft(region.className, "table-container neutralized so the outer focusable region scrolls").toMatch(/\[&[^:]*data-slot=table-container[^:]*\]?:contents/u);
    await user.click(screen.getByRole("button", { name: "Tablero" }));
    const clipped = backendCandidates.flatMap((candidate) => {
      const card = container.querySelector(`[data-pf-pipeline-card="${candidate.id}"]`) as HTMLElement;
      const name = card.querySelector("[data-slot='card-title'] h3") as HTMLElement;
      const title = Array.from(card.querySelectorAll("p")).find((node) => node.textContent === candidate.professionalTitle) as HTMLElement;
      expect.soft(name.textContent, `${candidate.id} keeps the full name`).toBe(candidate.fullName);
      expect.soft(title.textContent, `${candidate.id} keeps the full title`).toBe(candidate.professionalTitle);
      return [name, title].filter((node) => /(?:^|\s)(?:truncate|line-clamp-|h-(?:\[[^\]]+\]|\d)|max-h-)/u.test(node.className)).map((node) => node.textContent);
    });
    expect.soft(clipped, "identity text may wrap or balance but must never truncate, line-clamp or fix a height").toEqual([]);
  });
});
