import { describe, expect, it } from "vitest";

import {
  VACANCY_FORM_SECTIONS,
  sectionAnchorId,
  sectionTitle,
} from "./section-metadata";

describe("vacancy section metadata", () => {
  it("declares each section once, in order, with a stable title and anchor", () => {
    const ids = VACANCY_FORM_SECTIONS.map((section) => section.id);

    expect(ids).toEqual([
      "basic-information",
      "compensation",
      "description-requirements",
      "strategy",
      "benefits-pay-frequency",
      "screening",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sectionTitle("basic-information")).toBe("Información básica");
    expect(sectionAnchorId("compensation")).toBe("vacancy-section-compensation");
    expect(
      VACANCY_FORM_SECTIONS.every((section) => section.title.trim() !== ""),
    ).toBe(true);
  });
});
