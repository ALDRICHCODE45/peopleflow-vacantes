import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ActiveVacancies } from "./active-vacancies";
import type { EmployerVacancy } from "@/features/employer-vacancies/model";
import { EMPLOYER_VACANCY_STATE_LABELS, vacancyCandidateTotal, vacancyPipelineHref } from "@/features/employer-vacancies/model";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/active-vacancies.tsx"),
  "utf8",
);

/** Compact vacancy factory; the dashboard panel never reads `recruiter`/`publishedAt`. */
const make = (
  id: string,
  title: string,
  state: EmployerVacancy["state"],
  candidateCounts: EmployerVacancy["candidateCounts"],
): EmployerVacancy => ({
  id,
  title,
  workMode: "remote",
  employmentType: "full_time",
  state,
  publishedAt: "2026-03-09T15:00:00Z",
  recruiter: "Recruiter",
  teamSize: 1,
  candidateCounts,
});

const vacancies: readonly EmployerVacancy[] = [
  make("backend-developer-senior", "Backend Developer (Senior)", "active", { submitted: 3, in_review: 2, hired: 1, rejected: 1 }),
  make("frontend-engineer-react", "Frontend Engineer (React)", "active", { submitted: 6, in_review: 5, hired: 1, rejected: 3 }),
  make("fullstack-developer", "Fullstack Developer", "active", { submitted: 4, in_review: 4, hired: 1, rejected: 2 }),
  make("devops-engineer", "DevOps Engineer", "paused", { submitted: 2, in_review: 3, hired: 0, rejected: 1 }),
  make("qa-automation-engineer", "QA Automation Engineer", "closed", { submitted: 0, in_review: 0, hired: 4, rejected: 5 }),
];

function panel(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Vacantes activas", level: 2 });
  const sectionEl = heading.closest("section");
  expect(sectionEl, "panel section").not.toBeNull();
  return sectionEl as HTMLElement;
}

function rows(): HTMLElement[] {
  return Array.from(panel().querySelectorAll("li")) as HTMLElement[];
}

/** Natural Spanish agreement: singular for exactly 1 candidate, plural otherwise. */
const historyText = (total: number) =>
  `${total} candidato${total === 1 ? "" : "s"} en el historial`;

/** Every interactive link in the panel must clear the 40px + focus-visible bar. */
const HIT_AREA_REGEX = /min-h-10|\bh-10\b|min-h-\[40px\]|\bh-\[40px\]/u;
const FOCUS_REGEX = /focus-visible:ring/u;
/** Every literal paint a token-only surface must never carry in a class list. */
const RAW_COLOR = /oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/u;

afterEach(cleanup);

describe("ActiveVacancies heading and portfolio link", () => {
  it("renders the panel section with its Spanish heading and portfolio link", () => {
    render(<ActiveVacancies vacancies={vacancies} />);

    const heading = screen.getByRole("heading", { name: "Vacantes activas", level: 2 });
    expect(heading.tagName).toBe("H2");

    const sectionEl = panel();
    expect(sectionEl).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.id.length).toBeGreaterThan(0);

    const portfolioLink = screen.getByRole("link", { name: "Ver todas" });
    expect(portfolioLink).toHaveAttribute("href", "/empresa/vacantes");
    expect(portfolioLink.className).toMatch(HIT_AREA_REGEX);
    expect(portfolioLink.className).toMatch(FOCUS_REGEX);
  });
});

describe("ActiveVacancies derived active-only order and rows", () => {
  it("filters the portfolio to active vacancies in input order", () => {
    render(<ActiveVacancies vacancies={vacancies} />);

    expect(panel().querySelector("ul"), "semantic list").not.toBeNull();

    const ids = rows().map((row) => row.getAttribute("data-pf-active-vacancy-row"));
    expect(ids).toEqual([
      "backend-developer-senior",
      "frontend-engineer-react",
      "fullstack-developer",
    ]);
    // Paused and closed vacancies must never appear, even though they exist in
    // the input; the old HTML reference drifted from this contract.
    expect(ids).not.toContain("devops-engineer");
    expect(ids).not.toContain("qa-automation-engineer");
  });

  it("renders one canonical pipeline link per non-interactive row with truthful content", () => {
    render(<ActiveVacancies vacancies={vacancies} />);

    const expected = vacancies.slice(0, 3);
    const rendered = rows();
    expect(rendered).toHaveLength(3);

    for (const [index, vacancy] of expected.entries()) {
      const row = rendered[index];
      const total = vacancyCandidateTotal(vacancy.candidateCounts);

      // The row itself is not interactive: no anchor wrapping the whole row,
      // no nested controls. Exactly one pipeline anchor with the model helper's
      // canonical href and an accessible name that names the vacancy.
      expect(row.tagName).toBe("LI");
      expect(row.closest("a")).toBeNull();
      expect(row.querySelectorAll("button")).toHaveLength(0);

      const anchors = row.querySelectorAll("a");
      expect(anchors, `${vacancy.id} anchors`).toHaveLength(1);

      const link = anchors[0] as HTMLAnchorElement;
      expect([link.getAttribute("href"), link.getAttribute("aria-label"), link.textContent]).toEqual([
        vacancyPipelineHref(vacancy.id),
        `Ver pipeline de ${vacancy.title}`,
        "Ver pipeline",
      ]);

      // Truthful row content: title, natural history line, textual status.
      expect(within(row).getByText(vacancy.title)).toBeInTheDocument();
      expect(within(row).getByText(historyText(total))).toBeInTheDocument();
      expect(within(row).queryByText(/candidato\(s\)/u)).toBeNull();
      expect(within(row).getByText(EMPLOYER_VACANCY_STATE_LABELS.active)).toBeInTheDocument();

      // Semantic monogram on a token-only background; color is supplementary only.
      const monogram = row.querySelector("[data-pf-active-vacancy-monogram]");
      expect(monogram).not.toBeNull();
      expect(monogram!.getAttribute("aria-hidden")).toBe("true");
      expect(monogram!.textContent?.length).toBeGreaterThan(0);
      expect(monogram!.getAttribute("style")).toBeNull();
    }
  });
});

describe("ActiveVacancies interaction and token-only contract", () => {
  it("keeps every interactive link ≥40px tall with a visible focus ring", () => {
    render(<ActiveVacancies vacancies={vacancies} />);

    const links = screen.getAllByRole("link", { name: /Ver pipeline de |Ver todas/ });
    expect(links.length).toBe(4); // 3 pipeline + 1 portfolio
    for (const link of links) {
      expect((link as HTMLElement).className, link.textContent ?? "link").toMatch(HIT_AREA_REGEX);
      expect((link as HTMLElement).className, link.textContent ?? "link").toMatch(FOCUS_REGEX);
    }
  });

  it("keeps the responsive panel token-only and free of Card primitives, data-slot, and inline styles", () => {
    render(<ActiveVacancies vacancies={vacancies} />);

    const sectionEl = panel();
    const allClasses = Array.from(sectionEl.querySelectorAll("[class]"))
      .map((node) => node.getAttribute("class") ?? "")
      .join(" ");

    expect(allClasses).not.toMatch(RAW_COLOR);
    expect(sectionEl.querySelectorAll("[style]")).toHaveLength(0);
    expect(sectionEl.querySelectorAll("[data-slot='card']")).toHaveLength(0);
  });
});

describe("ActiveVacancies honest empty state", () => {
  it("renders the empty state on an empty portfolio while the link still works", () => {
    render(<ActiveVacancies vacancies={[]} />);

    expect(screen.getByText("No hay vacantes activas")).toBeInTheDocument();
    expect(panel().querySelectorAll("li")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/empresa/vacantes");
  });

  it("renders the empty state when only paused and closed vacancies exist", () => {
    render(
      <ActiveVacancies
        vacancies={[
          make("devops-engineer", "DevOps Engineer", "paused", { submitted: 1, in_review: 0, hired: 0, rejected: 0 }),
          make("qa-automation-engineer", "QA Automation Engineer", "closed", { submitted: 1, in_review: 0, hired: 0, rejected: 0 }),
        ]}
      />,
    );

    expect(screen.getByText("No hay vacantes activas")).toBeInTheDocument();
    expect(panel().querySelectorAll("li")).toHaveLength(0);
  });
});

describe("ActiveVacancies candidate-history agreement", () => {
  it("uses singular form for exactly one candidate and plural otherwise", () => {
    // Compact one-active-vacancy case: only one candidate, so the row must
    // render "1 candidato en el historial" (no plural marker, no (s)).
    const solo = make("solo-one", "Solo Position", "active", { submitted: 1, in_review: 0, hired: 0, rejected: 0 });
    const { rerender } = render(<ActiveVacancies vacancies={[solo]} />);
    let row = rows()[0];
    expect(within(row).getByText("1 candidato en el historial")).toBeInTheDocument();
    expect(within(row).queryByText(/candidato\(s\)/u)).toBeNull();
    expect(within(row).queryByText(/1 candidatos/u)).toBeNull();

    // Same shape with two candidates flips to the plural form.
    const pair = make("pair-positions", "Pair Position", "active", { submitted: 2, in_review: 0, hired: 0, rejected: 0 });
    rerender(<ActiveVacancies vacancies={[pair]} />);
    row = rows()[0];
    expect(within(row).getByText("2 candidatos en el historial")).toBeInTheDocument();
    expect(within(row).queryByText(/candidato\(s\)/u)).toBeNull();
    expect(within(row).queryByText(/2 candidato en el historial/u)).toBeNull();
  });
});

describe("ActiveVacancies source contract", () => {
  it("is a server-only, props-only component without client directives", () => {
    expect(source).not.toMatch(/["']use client["']/u);
    expect(source).not.toMatch(/\buseState\b|\buseEffect\b|\buseMemo\b|\buseCallback\b/u);
  });

  it("never imports the prototype fixture, fetch, storage, router, mutation, or global pipeline routes", () => {
    for (const forbidden of [
      "./prototype-vacancies",
      "features/employer-vacancies/prototype-vacancies",
      "NEXO_VACANCIES",
      "features/jobs",
      "@/features/jobs",
      "@/features/company-profile",
      "fetch(",
      "XMLHttpRequest",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "useRouter",
      "next/navigation",
      "onDrag",
      "draggable",
      "router.push",
      "router.replace",
      ".css",
      "Intl.DateTimeFormat",
      "Date.now",
      "new Date(",
    ]) {
      expect(source, `active-vacancies.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }

    // The canonical pipeline href must be reached through the model helper so
    // ids never drift from the route convention.
    expect(source).toContain("vacancyPipelineHref");
    expect(source).not.toMatch(/href=\{?["'`]?\/empresa\/vacantes\//u);
  });

  it("composes the panel without Card primitives, data-slot, or raw color", () => {
    expect(source).not.toContain("data-slot");
    expect(source).not.toMatch(/from\s+["']@\/components\/ui\/card/u);
    expect(source).not.toMatch(RAW_COLOR);
  });

  it("renders natural Spanish agreement, never the literal (s) marker", () => {
    // The candidate-history line must agree with the total: singular for 1,
    // plural otherwise. The literal technical marker "candidato(s)" is
    // forbidden anywhere in the component source.
    expect(source, "active-vacancies.tsx must not contain the literal (s) marker").not.toContain("candidato(s)");
  });
});
