import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { talentPersonSchema, type TalentPerson } from "./model";
import { TALENT_PEOPLE } from "./prototype-talent";
import { TalentSummary } from "./talent-summary";

const BASE = {
  id: "persona-base",
  fullName: "Persona Base",
  professionalTitle: "Desarrolladora Frontend",
  email: "persona-base@ejemplo.mx",
  phone: "+52 55 1000 2000",
  location: "Guadalajara",
  industry: "Tecnología",
  currentCompany: "Estudio Base",
  yearsOfExperience: 5,
  skills: ["React"],
  education: "Licenciatura en Ingeniería en Software",
  languages: [{ name: "Español", level: "native" }],
  preferredModality: "remote",
  availability: "immediate",
  applications: [
    {
      id: "persona-base-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-01T00:00:00Z",
    },
  ],
};

function makePerson(overrides: Record<string, unknown> = {}): TalentPerson {
  return talentPersonSchema.parse({ ...BASE, ...overrides });
}

function application(id: string, vacancyId: string) {
  return {
    id,
    vacancyId,
    stage: "submitted" as const,
    source: "direct" as const,
    appliedAt: "2026-03-01T00:00:00Z",
  };
}

/** Reads one rendered stat by its stable marker, never by Spanish copy. */
function statValue(id: "people" | "applications" | "immediate" | "vacancies"): string {
  const node = document.querySelector<HTMLElement>(
    `[data-pf-talento-stat-value="${id}"]`,
  );
  expect(node, `stat ${id}`).not.toBeNull();
  return node!.textContent?.trim() ?? "";
}

const STAT_IDS = ["people", "applications", "immediate", "vacancies"] as const;

const fourPeople: readonly TalentPerson[] = [
  makePerson({ id: "persona-uno" }),
  makePerson({
    id: "persona-dos",
    availability: "two_weeks",
    applications: [
      application("persona-dos-1", "data-analyst"),
      application("persona-dos-2", "devops-engineer"),
    ],
  }),
  makePerson({
    id: "persona-tres",
    availability: "one_month",
    applications: [application("persona-tres-1", "data-analyst")],
  }),
  makePerson({
    id: "persona-cuatro",
    availability: "to_confirm",
    applications: [application("persona-cuatro-1", "qa-automation-engineer")],
  }),
];

afterEach(cleanup);

describe("employer talent summary cards", () => {
  it("renders one installed Card per global counter from the whole base", () => {
    render(<TalentSummary people={fourPeople} />);

    const summary = document.querySelector("[data-pf-talento-summary]");
    expect(summary).not.toBeNull();
    const cards = summary!.querySelectorAll("[data-slot='card']");
    expect(cards).toHaveLength(4);

    for (const id of STAT_IDS) {
      const card = summary!.querySelector<HTMLElement>(
        `[data-pf-talento-stat="${id}"]`,
      );
      expect(card, `stat card ${id}`).not.toBeNull();
    }

    expect(statValue("people")).toBe("4");
    expect(statValue("applications")).toBe("5");
    expect(statValue("immediate")).toBe("1");
    expect(statValue("vacancies")).toBe("4");
  });

  it("reports zero counters for an empty base without inventing content", () => {
    render(<TalentSummary people={[]} />);

    for (const id of STAT_IDS) {
      expect(statValue(id)).toBe("0");
    }
  });

  it("counts duplicates and multi-application people without inflating the totals", () => {
    const duplicate = makePerson({
      id: "persona-duplicada",
      availability: "two_weeks",
      applications: [
        application("persona-duplicada-1", "frontend-engineer-react"),
        application("persona-duplicada-2", "frontend-engineer-react"),
      ],
    });
    render(<TalentSummary people={[fourPeople[0], duplicate]} />);

    // The immediate person counts once and the repeated vacancy counts once.
    expect(statValue("people")).toBe("2");
    expect(statValue("applications")).toBe("3");
    expect(statValue("immediate")).toBe("1");
    expect(statValue("vacancies")).toBe("1");
  });

  it("shows the committed fixture totals, computed from the fixture", () => {
    // Independently reduced from the frozen fixture, not assumed from a label.
    const reduced = TALENT_PEOPLE.reduce(
      (totals, person) => {
        totals.applications += person.applications.length;
        if (person.availability === "immediate") totals.immediate += 1;
        for (const value of person.applications) {
          totals.vacancies.add(value.vacancyId);
        }
        return totals;
      },
      { applications: 0, immediate: 0, vacancies: new Set<string>() },
    );

    render(<TalentSummary people={TALENT_PEOPLE} />);

    expect(statValue("people")).toBe(String(TALENT_PEOPLE.length));
    expect(statValue("applications")).toBe(String(reduced.applications));
    expect(statValue("immediate")).toBe(String(reduced.immediate));
    expect(statValue("vacancies")).toBe(String(reduced.vacancies.size));

    // The canonical fixture figures: 32 people, 41 applications, 12 immediate
    // and 6 distinct represented vacancies. A fixture drift fails loudly here.
    expect([TALENT_PEOPLE.length, reduced.applications, reduced.immediate, reduced.vacancies.size]).toEqual([
      32, 41, 12, 6,
    ]);
  });

  it("carries no growth or trend fiction", () => {
    render(<TalentSummary people={fourPeople} />);

    const summary = document.querySelector("[data-pf-talento-summary]")!;
    expect(summary.textContent ?? "").not.toMatch(/[+%]|tendencia|al alza|crecimiento/iu);
    // No trend badge, growth footer or decorative trend icon is rendered.
    expect(summary.querySelector("[data-pf-growth-footer]")).toBeNull();
    expect(summary.querySelectorAll("svg")).toHaveLength(0);
    for (const id of STAT_IDS) {
      expect(
        summary.querySelector(`[data-pf-talento-stat="${id}"] svg`),
      ).toBeNull();
    }
  });
});
