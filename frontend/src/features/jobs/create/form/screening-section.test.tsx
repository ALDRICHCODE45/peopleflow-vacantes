import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ScreeningSection } from "./screening-section";
import {
  INITIAL_PROTOTYPE_VALUES,
  MAX_SCREENING_QUESTIONS,
} from "./prototype-model";
import type { ScreeningQuestion, VacancyPrototypeValues } from "./prototype-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "screening-section.tsx"), "utf8");

const firstQuestion: ScreeningQuestion = {
  id: "question-1",
  prompt: "¿Cuántos años de experiencia tenés con React?",
};
const secondQuestion: ScreeningQuestion = {
  id: "question-2",
  prompt: "¿Trabajaste antes en equipos distribuidos?",
};
const thirdQuestion: ScreeningQuestion = {
  id: "question-3",
  prompt: "¿Tenés disponibilidad para viajar?",
};

afterEach(() => {
  cleanup();
});

function renderSection(overrides: Partial<VacancyPrototypeValues> = {}) {
  const values: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides,
  };
  const onChange = vi.fn();

  const view = render(<ScreeningSection values={values} onChange={onChange} />);

  return { ...view, values, onChange };
}

function firstPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls[0][0] as VacancyPrototypeValues;
}

describe("ScreeningSection empty state", () => {
  it("renders the section with an explicit empty state and an add action", () => {
    renderSection();

    // The step shell owns the heading; this module is a card-less field group.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("Sin preguntas de filtro")).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeEnabled();
    // Neutral Mexican Spanish, never voseo, on every visible state of this section.
    expect(screen.getByText(/Son opcionales: puedes publicar la vacante/u)).toBeVisible();
    expect(
      screen.getByText(/Agrega una pregunta para filtrar las postulaciones/u),
    ).toBeVisible();
  });

  it("adds the first question with a locally generated stable id", () => {
    const { onChange } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).screeningQuestions).toEqual([
      { id: "question-1", prompt: "" },
    ]);
  });

  it("never reuses an existing question id when adding another one", () => {
    const { onChange } = renderSection({ screeningQuestions: [firstQuestion] });

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));

    expect(firstPayload(onChange).screeningQuestions).toEqual([
      firstQuestion,
      { id: "question-2", prompt: "" },
    ]);
    expect(
      new Set(
        firstPayload(onChange).screeningQuestions.map((question) => question.id),
      ).size,
    ).toBe(2);
  });
});

describe("ScreeningSection question rows", () => {
  it("labels the questions in order and hides the empty state", () => {
    renderSection({ screeningQuestions: [firstQuestion, secondQuestion] });

    expect(screen.queryByText("Sin preguntas de filtro")).toBeNull();
    const questionInputs = screen.getAllByPlaceholderText(
      "Ej.: ¿Cuántos años de experiencia tienes con React?",
    );
    expect(questionInputs).toHaveLength(2);
    for (const input of questionInputs) expect(input).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toHaveValue(
      firstQuestion.prompt,
    );
    expect(screen.getByRole("textbox", { name: "Pregunta 2" })).toHaveValue(
      secondQuestion.prompt,
    );
    expect(
      screen.getByRole("button", { name: "Quitar pregunta 1" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Quitar pregunta 2" }),
    ).toBeVisible();
  });

  it("updates one question through the immutable helper", () => {
    const { values, onChange } = renderSection({
      screeningQuestions: [firstQuestion, secondQuestion],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 2" }), {
      target: { value: "¿Qué te motiva de este rol?" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).screeningQuestions).toEqual([
      firstQuestion,
      { id: "question-2", prompt: "¿Qué te motiva de este rol?" },
    ]);
    expect(values.screeningQuestions[1]).toBe(secondQuestion);
  });

  it("removes only the requested question", () => {
    const { values, onChange } = renderSection({
      screeningQuestions: [firstQuestion, secondQuestion, thirdQuestion],
    });

    fireEvent.click(screen.getByRole("button", { name: "Quitar pregunta 2" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).screeningQuestions).toEqual([
      firstQuestion,
      thirdQuestion,
    ]);
    expect(values.screeningQuestions).toHaveLength(3);
  });

  it("stops at the third question and disables the add action", () => {
    renderSection({
      screeningQuestions: [firstQuestion, secondQuestion, thirdQuestion],
    });

    expect(screen.getAllByRole("textbox")).toHaveLength(MAX_SCREENING_QUESTIONS);
    expect(screen.getByRole("textbox", { name: "Pregunta 3" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /^Quitar pregunta /u })).toHaveLength(
      MAX_SCREENING_QUESTIONS,
    );
  });
});

describe("ScreeningSection field-group boundary", () => {
  it("renders one field group with no card chrome of its own", () => {
    const { container } = renderSection();

    // The wizard step shell owns the single card of the step.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(container.querySelector('[data-slot="field-group"]')).not.toBeNull();
  });

  it("keeps the card out of the field group and delegates chrome to the step", () => {
    expect(source).not.toMatch(/from "\.\/form-section-card"/);
    expect(source).not.toMatch(/<FormSectionCard/);
    expect(source).not.toMatch(/sectionAnchorId|sectionTitle/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("ScreeningSection boundaries", () => {
  it("reuses the isolated prototype model and documented primitives", () => {
    expect(source).toMatch(/from "\.\/prototype-model"/);
    expect(source).toMatch(
      /addScreeningQuestion|removeScreeningQuestion|updateScreeningQuestion/,
    );
    expect(source).toMatch(/from "@\/components\/ui\/input"/);
    expect(source).toMatch(/from "@\/components\/ui\/empty"/);
    expect(source).toMatch(/from "@\/components\/ui\/button"/);
  });

  it("generates no identifier through a runtime global and stays off the request path", () => {
    expect(source).not.toMatch(/Math\.random|Date\.now|randomUUID|nanoid|crypto/);
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});
