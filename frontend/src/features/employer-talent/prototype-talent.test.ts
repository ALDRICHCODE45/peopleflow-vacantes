import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies";

import {
  TALENT_AVAILABILITIES,
  TALENT_INDUSTRIES,
  TALENT_LOCATIONS,
  TALENT_MODALITIES,
  TALENT_SKILLS,
  TALENT_SOURCES,
  TALENT_STAGES,
  TALENT_VACANCY_TITLES,
} from "./model";
import { TALENT_PEOPLE } from "@/features/employer-talent/prototype-talent";

const source = readFileSync(
  join(process.cwd(), "src/features/employer-talent/prototype-talent.ts"),
  "utf8",
);

const VACANCY_IDS = NEXO_VACANCIES.map((vacancy) => vacancy.id);

describe("employer talent fixture integrity", () => {
  it("ships a deterministic 30-50 person base", () => {
    expect(TALENT_PEOPLE.length).toBeGreaterThanOrEqual(30);
    expect(TALENT_PEOPLE.length).toBeLessThanOrEqual(50);
  });

  it("gives every person a stable unique id and one or more applications", () => {
    const ids = TALENT_PEOPLE.map((person) => person.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const person of TALENT_PEOPLE) {
      expect(person.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(person.applications.length).toBeGreaterThan(0);
      expect(person.applications.length).toBeLessThanOrEqual(4);
    }
  });

  it("keeps every application id globally unique", () => {
    const applicationIds = TALENT_PEOPLE.flatMap((person) =>
      person.applications.map((application) => application.id),
    );
    expect(new Set(applicationIds).size).toBe(applicationIds.length);
  });

  it("only references real Nexo vacancies", () => {
    for (const person of TALENT_PEOPLE) {
      for (const application of person.applications) {
        expect(
          VACANCY_IDS,
          `${person.id} vacancy ${application.vacancyId}`,
        ).toContain(application.vacancyId);
      }
    }
  });

  it("uses only the closed stage, source, skill, location and industry vocabularies", () => {
    for (const person of TALENT_PEOPLE) {
      expect(TALENT_INDUSTRIES).toContain(person.industry);
      expect(TALENT_LOCATIONS).toContain(person.location);
      expect(TALENT_MODALITIES).toContain(person.preferredModality);
      expect(TALENT_AVAILABILITIES).toContain(person.availability);
      expect(person.skills.length).toBeGreaterThan(0);
      for (const skill of person.skills) expect(TALENT_SKILLS).toContain(skill);
      for (const application of person.applications) {
        expect(TALENT_STAGES).toContain(application.stage);
        expect(TALENT_SOURCES).toContain(application.source);
        expect(application.appliedAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
        );
      }
    }
  });

  it("never puts a universal status or match score on a person", () => {
    for (const person of TALENT_PEOPLE) {
      expect(Object.keys(person)).not.toContain("status");
      expect(Object.keys(person)).not.toContain("stage");
      expect(Object.keys(person)).not.toContain("matchScore");
      expect(JSON.stringify(person)).not.toContain("matchScore");
    }
    expect(source).not.toContain("matchScore");
  });

  it("varies profile, contact, experience and preferences", () => {
    const locations = new Set(TALENT_PEOPLE.map((person) => person.location));
    const industries = new Set(TALENT_PEOPLE.map((person) => person.industry));
    const modalities = new Set(
      TALENT_PEOPLE.map((person) => person.preferredModality),
    );
    const availabilities = new Set(
      TALENT_PEOPLE.map((person) => person.availability),
    );
    const skills = new Set(TALENT_PEOPLE.flatMap((person) => person.skills));
    const emails = new Set(TALENT_PEOPLE.map((person) => person.email));
    const experiences = new Set(
      TALENT_PEOPLE.map((person) => person.yearsOfExperience),
    );

    expect(locations.size).toBeGreaterThanOrEqual(6);
    expect(industries.size).toBeGreaterThanOrEqual(5);
    expect(modalities.size).toBe(3);
    expect(availabilities.size).toBeGreaterThanOrEqual(3);
    expect(skills.size).toBeGreaterThanOrEqual(15);
    expect(emails.size).toBe(TALENT_PEOPLE.length);
    expect(experiences.size).toBeGreaterThanOrEqual(8);
  });

  it("includes multi-application people so histories are never inferred from names", () => {
    const multi = TALENT_PEOPLE.filter(
      (person) => person.applications.length > 1,
    );
    expect(multi.length).toBeGreaterThanOrEqual(5);
    for (const person of multi) {
      const vacancyIds = person.applications.map(
        (application) => application.vacancyId,
      );
      expect(new Set(vacancyIds).size).toBe(vacancyIds.length);
    }
  });

  it("maps every used vacancy id to its Nexo title", () => {
    for (const vacancy of NEXO_VACANCIES) {
      expect(TALENT_VACANCY_TITLES[vacancy.id]).toBe(vacancy.title);
    }
    for (const person of TALENT_PEOPLE) {
      for (const application of person.applications) {
        expect(TALENT_VACANCY_TITLES[application.vacancyId]).toBeTruthy();
      }
    }
  });

  it("stays deterministic and free of clocks, randomness or I/O", () => {
    for (const forbidden of [
      "Math.random",
      "Date.now",
      "new Date(",
      "fetch(",
      "localStorage",
      "sessionStorage",
      "@tanstack",
      '"use client"',
    ]) {
      expect(source, `fixture must not use ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("freezes the fixture so no screen can mutate it", () => {
    expect(Object.isFrozen(TALENT_PEOPLE)).toBe(true);
    const first = TALENT_PEOPLE[0];
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.applications)).toBe(true);
  });
});
