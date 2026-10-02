import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom implements neither matchMedia nor ResizeObserver; the combobox and the
// Base UI dialog both read them.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1280);
}

/**
 * DatePickerField jsdom boundary, mirroring the committed talent suite: the real
 * Base UI popover close path refocus-loops under jsdom. The controlled harness
 * keeps the field's props and emitted civil dates observable; real calendar
 * behaviour is asserted in Playwright, never here.
 */
vi.mock("@/components/ui/popover", () => {
  const PopoverTestContext = React.createContext<{
    open: boolean;
    setOpen?: (next: boolean) => void;
  }>({ open: false });

  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: React.ReactNode;
    }) => (
      <PopoverTestContext.Provider value={{ open: Boolean(open), setOpen: onOpenChange }}>
        <div data-slot="pipeline-test-popover">{children}</div>
      </PopoverTestContext.Provider>
    ),
    PopoverTrigger: ({
      render,
    }: {
      render: React.ReactElement<{ onClick?: () => void }>;
    }) => {
      const { setOpen } = React.useContext(PopoverTestContext);
      return React.cloneElement(render, { onClick: () => setOpen?.(true) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => {
      const { open } = React.useContext(PopoverTestContext);
      return open ? <div role="dialog">{children}</div> : null;
    },
  };
});

const calendar = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: {
    disabled?: { before?: Date; after?: Date };
    onSelect?: (date: Date | undefined) => void;
  }) => {
    calendar.props = props;
    return (
      <div data-slot="pipeline-test-calendar">
        {[3, 10, 12, 15].map((day) => (
          <button
            key={day}
            type="button"
            aria-label={`Día ${day}`}
            onClick={() => props.onSelect?.(new Date(2026, 2, day))}
          />
        ))}
      </div>
    );
  },
}));

/**
 * Combobox jsdom boundary: only the anchored portal wrapper is replaced, so the
 * real options, filtering, chips and selection stay exercised while the
 * expensive positioning loop is skipped. Real portal composition is proven in
 * Playwright.
 */
vi.mock("@/components/ui/combobox", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/combobox")>(
    "@/components/ui/combobox",
  );
  return {
    ...actual,
    ComboboxContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const filterTrigger = () => screen.getByRole("button", { name: /^Filtros/u });

function filterSheet(): HTMLElement {
  const sheet = document.querySelector<HTMLElement>("[data-pf-pipeline-filters]");
  expect(sheet, "filter sheet").not.toBeNull();
  return sheet as HTMLElement;
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(filterTrigger());
  await waitFor(() => {
    expect(document.querySelector("[data-pf-pipeline-filters]")).not.toBeNull();
  });
  return filterSheet();
}

/** Selects one real option of a facet's searchable multi-select. */
function selectFacetOption(facet: string, optionLabel: string) {
  expect(
    document.getElementById(`pipeline-filtro-${facet}`),
    `facet input ${facet}`,
  ).not.toBeNull();
  const el = screen.getByRole("option", { name: optionLabel });
  fireEvent.click(el);
}

const chip = (key: string) =>
  document.querySelector<HTMLElement>(`[data-pf-pipeline-chip="${key}"]`);

const receivedFromTrigger = () =>
  document.getElementById("pipeline-recibidos-desde") as HTMLButtonElement;
const receivedToTrigger = () =>
  document.getElementById("pipeline-recibidos-hasta") as HTMLButtonElement;

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
      "./model", "./pipeline-model", "./pipeline-filter-model", "./pipeline-filters",
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

describe("PipelineWorkspace filter sheet", () => {
  beforeEach(stubBrowserApis);

  it("opens a floating filter Sheet with the core facets and the received-date range", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const trigger = filterTrigger();
    expect(trigger).toHaveTextContent("Filtros");
    await user.click(trigger);
    const sheet = filterSheet();

    expect(within(sheet).getByText("Filtros")).toBeInTheDocument();
    for (const legend of ["Etapa", "Origen", "Habilidades"]) {
      expect(
        within(sheet).getByRole("combobox", { name: legend }),
        `facet combobox ${legend}`,
      ).toBeInTheDocument();
    }
    const experience = sheet.querySelector(
      '[data-pf-pipeline-facet="experience"]',
    ) as HTMLElement;
    expect(experience).not.toBeNull();
    const experienceToggle = experience.querySelector("[data-slot='toggle-group']") as HTMLElement;
    expect(experienceToggle).not.toBeNull();
    expect(experienceToggle).toHaveAccessibleName("Experiencia");
    for (const bucket of ["0-2", "3-5", "6-9", "10+"]) {
      expect(
        experienceToggle.querySelector(`[data-pf-pipeline-option="experience:${bucket}"]`),
        bucket,
      ).not.toBeNull();
    }
    expect(sheet.querySelector("[data-pf-pipeline-received-from]")).not.toBeNull();
    expect(sheet.querySelector("[data-pf-pipeline-received-to]")).not.toBeNull();
    expect(sheet.querySelector("[data-pf-pipeline-filters-reset]")).not.toBeNull();
    expect(sheet.querySelector("[data-pf-pipeline-filters-close]")).not.toBeNull();
    // Truthful scope: the pipeline candidate model owns no industry or location.
    expect(sheet.querySelector('[data-pf-pipeline-facet="industry"]')).toBeNull();
    expect(sheet.querySelector('[data-pf-pipeline-facet="location"]')).toBeNull();
  });

  it("shows no filter count until a criterion is active, then counts each active value", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-pf-pipeline-filter-count]")).toBeNull();

    await openFilters(user);
    selectFacetOption("status", "Nuevos");
    selectFacetOption("status", "Contratados");
    const count = container.querySelector("[data-pf-pipeline-filter-count]") as HTMLElement;
    expect(count).toHaveTextContent("2");
  });

  it("ORs values inside a facet and ANDs across facets without leaving either view", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Nuevos");
    selectFacetOption("status", "Contratados");
    expect(cardIds(container).sort()).toEqual(["lucia-fernandez", "renata-vargas"]);

    // AND: source Directo keeps only Renata, so the OR set narrows to one.
    selectFacetOption("source", "Directo");
    expect(cardIds(container)).toEqual(["renata-vargas"]);

    // AND with a non-matching skill empties the set without inventing a card.
    selectFacetOption("skill", "Node.js");
    expect(cardIds(container)).toEqual([]);

    // OR inside skills brings Lucia back only through her own skill.
    selectFacetOption("skill", "AWS");
    expect(cardIds(container)).toEqual(["renata-vargas"]);
  });

  it("keeps one filtered array shared by both view modes", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Nuevos");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(cardIds(container)).toEqual(["lucia-fernandez"]);
    await user.click(screen.getByRole("button", { name: "Lista" }));
    expect(rowIds(container)).toEqual(["lucia-fernandez"]);
    expect(container.querySelectorAll("[data-pf-pipeline-search]")).toHaveLength(1);
  });

  it("preserves the historical denominator while filters narrow the visible set", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Contratados");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(container.querySelector("[data-pf-pipeline-sample]")).toHaveTextContent(
      visibleCandidatesCopy(1, vacancyCandidateTotal(backend.candidateCounts)),
    );
    expect(container.querySelector("[data-pf-pipeline-sample]")).toHaveTextContent(
      visibleCandidatesCopy(1, 7),
    );
  });

  it("renders one removable chip per active value and preserves the rest when one is removed", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Nuevos");
    selectFacetOption("source", "LinkedIn");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(chip("status:submitted")).toHaveTextContent("Etapa: Nuevos");
    expect(chip("source:linkedin")).toHaveTextContent("Origen: LinkedIn");

    await user.click(chip("status:submitted") as HTMLElement);
    expect(chip("status:submitted")).toBeNull();
    expect(chip("source:linkedin")).toHaveTextContent("Origen: LinkedIn");
    expect(cardIds(container)).toEqual(["lucia-fernandez"]);
  });

  it("resets the search and every facet together from the sheet footer", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await user.type(screen.getByLabelText("Buscar candidato"), "lucia");
    await openFilters(user);
    selectFacetOption("status", "Nuevos");
    await user.click(document.querySelector("[data-pf-pipeline-filters-reset]") as HTMLElement);
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(screen.getByLabelText("Buscar candidato")).toHaveValue("");
    expect(chip("query")).toBeNull();
    expect(chip("status:submitted")).toBeNull();
    expect(cardIds(container)).toHaveLength(4);
  });

  it("keeps every option stable from the unfiltered vacancy input", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openFilters(user);
    const before = Array.from(document.querySelectorAll("[data-pf-pipeline-option]")).map(
      (node) => node.getAttribute("data-pf-pipeline-option"),
    );
    expect(before).toContain("status:rejected");
    expect(before).toContain("source:job_board");
    expect(before).toContain("skill:PHP");

    selectFacetOption("status", "Nuevos");
    const after = Array.from(document.querySelectorAll("[data-pf-pipeline-option]")).map(
      (node) => node.getAttribute("data-pf-pipeline-option"),
    );
    expect(after).toEqual(before);
  });

  it("exposes the empty result as a filtered-zero recovery, not an empty vacancy", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Descartados");
    selectFacetOption("source", "LinkedIn");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(cardIds(container)).toEqual([]);
    const recovery = container.querySelector("[data-pf-pipeline-recovery]") as HTMLElement;
    expect(recovery).not.toBeNull();
    expect(recovery).toHaveTextContent("No hay candidatos que coincidan con los filtros aplicados.");
    expect(recovery).not.toHaveTextContent("Sin candidatos en esta vacante");
  });

  it("closes with Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const trigger = filterTrigger();
    await user.click(trigger);
    await waitFor(() => {
      expect(document.activeElement?.closest("[data-pf-pipeline-filters]")).not.toBeNull();
    });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => {
      expect(document.querySelector("[data-pf-pipeline-filters]")).toBeNull();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });
});

describe("PipelineWorkspace facet combobox selection identity", () => {
  beforeEach(stubBrowserApis);

  const facet = (name: string) =>
    document.querySelector<HTMLElement>(`[data-pf-pipeline-facet="${name}"]`) as HTMLElement;
  const facetOption = (name: string, value: string) =>
    document.querySelector<HTMLElement>(`[data-pf-pipeline-option="${name}:${value}"]`);
  const highlightedOptions = () =>
    Array.from(document.querySelectorAll("[data-highlighted][data-pf-pipeline-option]")).map(
      (node) => node.getAttribute("data-pf-pipeline-option"),
    );
  const openFacet = (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(document.getElementById(`pipeline-filtro-${name}`) as HTMLElement);

  it("anchors the reopened popup and keyboard navigation on the selected domain id", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openFilters(user);
    selectFacetOption("status", "Contratados");
    expect(facetOption("status", "hired")).toHaveAttribute("aria-selected", "true");
    expect(facetOption("status", "submitted")).toHaveAttribute("aria-selected", "false");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    // Reopen the Sheet and the facet popup: the selected option must be the one
    // the popup anchors on, so the first ArrowDown lands on its neighbour and not
    // on the first option. This only holds while `items`, `value` and every
    // `ComboboxItem` value share the same primitive domain id.
    await openFilters(user);
    await openFacet(user, "status");
    await waitFor(() => {
      expect(facetOption("status", "hired")).not.toBeNull();
    });
    expect(facetOption("status", "hired")).toHaveAttribute("data-highlighted");
    await user.keyboard("{ArrowDown}");
    expect(highlightedOptions()).toEqual(["status:rejected"]);
    await user.keyboard("{Enter}");
    expect(facet("status").querySelector("[data-slot='combobox-chip']"))?.toHaveTextContent(
      "Contratados",
    );
    expect(facet("status").querySelectorAll("[data-slot='combobox-chip']")).toHaveLength(2);
  });

  it("searches options by their Spanish label while storing the domain id", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openFilters(user);
    await openFacet(user, "status");
    await user.keyboard("contrat");
    await waitFor(() => {
      expect(facetOption("status", "hired")).not.toBeNull();
      expect(facetOption("status", "submitted")).toBeNull();
    });
    expect(facetOption("status", "hired")).toHaveTextContent("Contratados");

    fireEvent.click(facetOption("status", "hired") as HTMLElement);
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);
    // The chip is keyed and labelled from the domain id, never from a raw object.
    expect(chip("status:hired")).toHaveTextContent("Etapa: Contratados");
    expect(chip("status:hired")?.textContent).not.toContain("[object Object]");
  });

  it("selects the highlighted option with the keyboard and filters by its domain id", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    await openFacet(user, "status");
    await user.keyboard("contrat");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(chip("status:hired")).toHaveTextContent("Etapa: Contratados");
    expect(cardIds(container)).toEqual(["renata-vargas"]);
  });

  it("toggles a selected option off by the same domain id and keeps its label", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await openFilters(user);
    expect(facet("status").querySelector("[data-slot='combobox-chip']")).toBeNull();
    selectFacetOption("status", "Contratados");
    expect(facet("status").querySelector("[data-slot='combobox-chip']")).toHaveTextContent(
      "Contratados",
    );
    fireEvent.click(facetOption("status", "hired") as HTMLElement);
    expect(facet("status").querySelector("[data-slot='combobox-chip']")).toBeNull();
  });
});

describe("PipelineWorkspace experience filter", () => {
  beforeEach(stubBrowserApis);

  it("keeps a structurally typed candidate above the validator ceiling inside 10+", async () => {
    const user = userEvent.setup();
    // The shared pipeline schema caps `yearsOfExperience` at 60; the filter model
    // receives the frozen `PipelineCandidate` type, so a higher value is a valid
    // input the 10+ bucket must not drop.
    const roster: readonly PipelineCandidate[] = [
      { ...backendCandidates[2], id: "renata-vargas", yearsOfExperience: 11 },
      { ...backendCandidates[0], id: "veteran-beyond-ceiling", yearsOfExperience: 72 },
    ];
    const { container } = renderWorkspace(backend, roster);

    await openFilters(user);
    const experience = filterSheet().querySelector(
      '[data-pf-pipeline-facet="experience"]',
    ) as HTMLElement;
    fireEvent.click(
      experience.querySelector('[data-pf-pipeline-option="experience:10+"]') as HTMLElement,
    );
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);

    expect(chip("experience:10+")).toHaveTextContent("Experiencia: 10 años o más");
    expect(cardIds(container).sort()).toEqual(["renata-vargas", "veteran-beyond-ceiling"]);
  });
});

describe("PipelineWorkspace received-date filter", () => {
  beforeEach(() => {
    stubBrowserApis();
    vi.setSystemTime(new Date(2026, 2, 15, 12));
  });

  it("filters inclusively on the received civil day and opens the past window", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    await user.click(receivedFromTrigger());
    const props = calendar.props as { disabled?: { before?: Date; after?: Date } };
    expect(props.disabled?.before).toBeUndefined();
    expect(props.disabled?.after).toEqual(new Date(2026, 2, 15));
    fireEvent.click(screen.getByRole("button", { name: "Día 3" }));

    expect(chip("receivedFrom")).toHaveTextContent("Recibidos desde: 2026-03-03");
    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);
    expect(cardIds(container).sort()).toEqual(["diego-salazar", "lucia-fernandez"]);
  });

  it("reports reversed bounds without silently swapping them", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();

    await openFilters(user);
    await user.click(receivedFromTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Día 10" }));
    await user.click(receivedToTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Día 3" }));

    const error = document.querySelector("[data-pf-pipeline-range-error]") as HTMLElement;
    expect(error).not.toBeNull();
    expect(error).toHaveTextContent(/posterior a la final/iu);
    expect(chip("receivedFrom")).toHaveTextContent("Recibidos desde: 2026-03-10");
    expect(chip("receivedTo")).toHaveTextContent("Recibidos hasta: 2026-03-03");

    await user.click(document.querySelector("[data-pf-pipeline-filters-close]") as HTMLElement);
    expect(cardIds(container)).toEqual([]);
  });
});

describe("PipelineWorkspace filter boundary", () => {
  it("declares no transport, storage or routing concern in the filter surface", () => {
    const filterSource = readFileSync(
      join(process.cwd(), "src/features/employer-vacancies/pipeline-filters.tsx"),
      "utf8",
    );
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "useRouter",
      "next/navigation",
      "features/jobs",
      "prototype-candidates",
      "NEXO_CANDIDATES",
    ]) {
      expect(filterSource, `pipeline-filters.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    for (const raw of ['bg-blue-', 'bg-red-', "#", "dark:"]) {
      expect(filterSource, `pipeline-filters.tsx must not paint raw ${raw}`).not.toContain(raw);
    }
  });
});
