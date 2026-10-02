import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { INITIAL_VALUES } from "./model";
import { INITIAL_PROTOTYPE_VALUES } from "./prototype-model";
import type { ScreeningQuestion, VacancyPrototypeValues } from "./prototype-model";
import { ReviewStep } from "./review-step";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "review-step.tsx"), "utf8");

const firstQuestion: ScreeningQuestion = {
  id: "question-1",
  prompt: "¿Cuántos años de experiencia tenés con React?",
};
const secondQuestion: ScreeningQuestion = {
  id: "question-2",
  prompt: "¿Trabajaste antes en equipos distribuidos?",
};

afterEach(() => {
  cleanup();
});

function renderReview(prototype: Partial<VacancyPrototypeValues> = {}) {
  const onEditStep = vi.fn();
  const view = render(
    <ReviewStep
      values={INITIAL_VALUES}
      prototypeValues={{ ...INITIAL_PROTOTYPE_VALUES, ...prototype }}
      onEditStep={onEditStep}
    />,
  );
  return { ...view, onEditStep };
}

/** The summary card of the process step that owns the screening questions. */
function conditionsGroup(): HTMLElement {
  const group = document.querySelector(
    "[data-pf-review-group='conditions-process']",
  );
  if (group === null) throw new Error("conditions-process group is not mounted");
  return group as HTMLElement;
}

describe("ReviewStep neutral Mexican copy", () => {
  it("states the step summary in neutral Mexican Spanish", () => {
    const { container } = renderReview();

    expect(
      within(container).getByText(
        "Revisa el contenido de cada paso antes de guardar el borrador.",
      ),
    ).toBeVisible();
  });
});

describe("ReviewStep screening questions", () => {
  it("shows every written question prompt in order inside the process group", () => {
    renderReview({ screeningQuestions: [firstQuestion, secondQuestion] });

    const items = within(conditionsGroup()).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(firstQuestion.prompt);
    expect(items[1]).toHaveTextContent(secondQuestion.prompt);
    // The count stays available next to the audited prompts.
    expect(within(conditionsGroup()).getByText("2 de 3")).toBeVisible();
  });

  it("keeps the truthful empty state when no question was written", () => {
    renderReview();

    const group = conditionsGroup();
    expect(within(group).getByText("Sin preguntas")).toBeVisible();
    expect(within(group).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders the full prompt text without a truncating class", () => {
    const longPrompt =
      "Describí en detalle un incidente productivo que hayas resuelto end to end, incluyendo el diagnóstico, la mitigación y el aprendizaje posterior.";
    renderReview({
      screeningQuestions: [{ id: "question-1", prompt: longPrompt }],
    });

    const item = within(conditionsGroup()).getByRole("listitem");
    expect(item).toHaveTextContent(longPrompt);
    expect(item.className).not.toMatch(/truncate|line-clamp/u);
  });

  it("keeps a written question visible even when its prompt is still blank", () => {
    renderReview({ screeningQuestions: [{ id: "question-1", prompt: "   " }] });

    const items = within(conditionsGroup()).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Sin especificar");
    expect(within(conditionsGroup()).getByText("1 de 3")).toBeVisible();
  });
});

describe("ReviewStep boundaries", () => {
  it("stays off the request path and free of a truncating clamp", () => {
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/line-clamp|truncate/u);
  });
});
