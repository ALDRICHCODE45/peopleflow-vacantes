import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

/**
 * Base UI's portaled select popup needs browser positioning jsdom cannot
 * complete, so this adapter preserves the real controlled `value` / `items` /
 * `onValueChange` contract as a native select.
 */
vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  type Option = Readonly<{ value: string; label: string }>;
  type State = Readonly<{
    items: readonly Option[];
    value: string;
    onValueChange: (value: string) => void;
  }>;
  type RootProps = Readonly<{
    items?: readonly Option[];
    value?: string | null;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }>;
  const Context = ReactModule.createContext<State | null>(null);
  const NullPart = () => null;

  function Select({
    items = [],
    value = null,
    onValueChange = () => undefined,
    children,
  }: RootProps) {
    return (
      <Context.Provider value={{ items, value: value ?? "", onValueChange }}>
        {children}
      </Context.Provider>
    );
  }

  function SelectTrigger(props: React.ComponentProps<"select">) {
    const state = ReactModule.useContext(Context);
    if (!state) throw new Error("SelectTrigger requires Select");
    return (
      <select
        {...props}
        data-slot="select-trigger"
        value={state.value}
        onChange={(event) => state.onValueChange(event.target.value)}
      >
        <option value="">Sin selección</option>
        {state.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue: NullPart,
    SelectContent: NullPart,
    SelectGroup: NullPart,
    SelectItem: NullPart,
  };
});

import type { DraftFormErrors } from "./draft-form-state";
import { DraftScreeningV2Field } from "./draft-screening-v2-field";
import {
  SCREENING_OPTIONS_MAX,
  SCREENING_QUESTIONS_MAX,
  createScreeningQuestionV2,
  type DraftScreeningV2Question,
  type DraftScreeningV2State,
} from "./draft-screening-v2-state";
import { SCREENING_EMPTY_ERROR } from "./draft-messages";

const OID1 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OID2 = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const QUESTION_ID = "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SECOND_ID = "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";

function question(
  overrides: Partial<DraftScreeningV2Question> = {},
): DraftScreeningV2Question {
  return {
    id: QUESTION_ID,
    type: "single_choice_informative",
    prompt: "¿Qué modalidad prefieres?",
    options: [
      { id: OID1, label: "Remoto" },
      { id: OID2, label: "Híbrido" },
    ],
    correctOptionId: "",
    ...overrides,
  };
}

/** The collapsed accordion header of the nth question, queried by its name. */
const trigger = (n: number) =>
  screen.getByRole("button", {
    name: (accessibleName: string) => accessibleName.startsWith(`Pregunta ${n}:`),
  });
/** The prompt textarea of the nth question; null while its panel is collapsed. */
const prompt = (n: number) => screen.queryByRole("textbox", { name: `Pregunta ${n}` });

/** Controlled harness that mirrors the real state updates into the DOM. */
function Harness({
  initial,
  errors,
  onState,
}: {
  initial: DraftScreeningV2State;
  errors?: DraftFormErrors;
  onState?: (state: DraftScreeningV2State) => void;
}) {
  const [questions, setQuestions] = React.useState(initial);
  return (
    <DraftScreeningV2Field
      questions={questions}
      errors={errors ?? {}}
      onChange={(next) => {
        setQuestions(next);
        onState?.(next);
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DraftScreeningV2Field accordion", () => {
  it("groups every question in one official accordion with a compact summary and an external add action", () => {
    const { container } = render(
      <DraftScreeningV2Field
        questions={[question(), question({ id: SECOND_ID, prompt: "Segunda pregunta" })]}
        errors={{}}
        onChange={() => undefined}
      />,
    );

    const accordion = container.querySelector('[data-slot="accordion"]');
    expect(accordion).not.toBeNull();
    const items = container.querySelectorAll(
      '[data-pf-screening-v2-question][data-slot="accordion-item"]',
    );
    expect(items).toHaveLength(2);

    // The add action stays outside the accordion so no button nests in a trigger.
    const addButton = screen.getByRole("button", { name: "Agregar pregunta" });
    expect((accordion as HTMLElement).contains(addButton)).toBe(false);

    // Compact collapsed summary: number, prompt, human type and option count.
    expect(trigger(1).tagName).toBe("BUTTON");
    expect(trigger(1)).toHaveTextContent("Pregunta 1");
    expect(trigger(1)).toHaveTextContent("¿Qué modalidad prefieres?");
    expect(trigger(1)).toHaveTextContent("Opción única (informativa)");
    expect(trigger(1)).toHaveTextContent("2 opciones");
    // The internal option ids never leak into the visible summary.
    expect(trigger(1)).not.toHaveTextContent(OID1);
  });

  it("keeps a single question open at a time", () => {
    render(
      <Harness
        initial={[question(), question({ id: SECOND_ID, prompt: "Segunda pregunta" })]}
      />,
    );

    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");
    expect(trigger(2)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger(1));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "true");
    expect(trigger(2)).toHaveAttribute("aria-expanded", "false");
    expect(prompt(1)).toBeVisible();
    expect(prompt(2)).toBeNull();

    fireEvent.click(trigger(2));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");
    expect(trigger(2)).toHaveAttribute("aria-expanded", "true");
    expect(prompt(1)).toBeNull();
    expect(prompt(2)).toBeVisible();
  });

  it("collapses the open question when its own trigger is activated again", () => {
    render(<Harness initial={[question()]} />);

    fireEvent.click(trigger(1));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger(1));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");
    expect(prompt(1)).toBeNull();
  });

  it("preserves the typed prompt across a collapse and reopen", () => {
    render(<Harness initial={[question({ type: "open", options: [] })]} />);

    fireEvent.click(trigger(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "Cuéntanos sobre ti" },
    });

    fireEvent.click(trigger(1));
    expect(prompt(1)).toBeNull();

    fireEvent.click(trigger(1));
    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toHaveValue(
      "Cuéntanos sobre ti",
    );
  });

  it("updates the collapsed summary when the prompt and the type change", () => {
    render(<Harness initial={[question({ type: "open", options: [], prompt: "" })]} />);

    expect(trigger(1)).toHaveTextContent("Sin enunciado");
    expect(trigger(1)).toHaveTextContent("Sin opciones");

    fireEvent.click(trigger(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "  " },
    });
    expect(trigger(1)).toHaveTextContent("Sin enunciado");
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    expect(trigger(1)).toHaveTextContent("¿Cuál es tu experiencia?");

    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de pregunta 1" }), {
      target: { value: "single_choice_evaluated" },
    });
    expect(trigger(1)).toHaveTextContent("Opción única (con respuesta correcta)");
    expect(trigger(1)).toHaveTextContent("0 opciones");
  });

  it("auto-opens the freshly added question", () => {
    render(<Harness initial={[question()]} />);

    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));

    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");
    expect(trigger(2)).toHaveAttribute("aria-expanded", "true");
    expect(prompt(2)).toBeVisible();
    expect(trigger(2)).toHaveTextContent("Sin enunciado");
    expect(trigger(2)).toHaveTextContent("Sin opciones");
  });

  it("opens the first invalid question when a validation request arrives", () => {
    render(
      <DraftScreeningV2Field
        questions={[question(), question({ id: SECOND_ID, prompt: "Segunda pregunta" })]}
        errors={{ "screening_questions.1.prompt": SCREENING_EMPTY_ERROR }}
        onChange={() => undefined}
        openFirstInvalidToken={1}
      />,
    );

    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");
    expect(trigger(2)).toHaveAttribute("aria-expanded", "true");
  });

  it("re-opens the first invalid question on a repeated request, even after a manual collapse", () => {
    const questions = [question()];
    const errors = { "screening_questions.0.prompt": SCREENING_EMPTY_ERROR };
    const renderField = (token: number) => (
      <DraftScreeningV2Field
        questions={questions}
        errors={errors}
        onChange={() => undefined}
        openFirstInvalidToken={token}
      />
    );

    const { rerender } = render(renderField(1));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger(1));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "false");

    rerender(renderField(2));
    expect(trigger(1)).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the remove action outside the trigger so no button nests", () => {
    render(<Harness initial={[question()]} />);

    fireEvent.click(trigger(1));

    expect(trigger(1).querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Quitar pregunta 1" })).toBeVisible();
  });

  it("opens the predictable neighbor when the open question is removed", () => {
    render(
      <Harness
        initial={[question(), question({ id: SECOND_ID, prompt: "Segunda pregunta" })]}
      />,
    );

    fireEvent.click(trigger(1));
    fireEvent.click(screen.getByRole("button", { name: "Quitar pregunta 1" }));

    // The removed question is gone and the surviving neighbor opened instead of
    // keeping a stale id in the controlled accordion value.
    expect(screen.queryByText("¿Qué modalidad prefieres?")).toBeNull();
    expect(trigger(1)).toHaveTextContent("Segunda pregunta");
    expect(trigger(1)).toHaveAttribute("aria-expanded", "true");
    expect(prompt(1)).toBeVisible();
  });

  it("collapses to the empty state when the only question is removed", () => {
    render(<Harness initial={[question()]} />);

    fireEvent.click(trigger(1));
    fireEvent.click(screen.getByRole("button", { name: "Quitar pregunta 1" }));

    expect(screen.getByText(/sin preguntas por ahora/i)).toBeVisible();
    expect(prompt(1)).toBeNull();
  });
});

describe("DraftScreeningV2Field content", () => {
  it("starts empty with the add control and no invented question", () => {
    render(<Harness initial={[]} />);

    expect(screen.getByText(/sin preguntas por ahora/i)).toBeVisible();
    expect(screen.getByText(/sin preguntas por ahora/i)).toHaveClass("text-xl", "font-semibold");
    const add = screen.getByRole("button", { name: "Agregar pregunta" });
    expect(add).toBeEnabled();
    expect(add.closest('[data-slot="empty-content"]')).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Agregar pregunta" })).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Pregunta 1" })).toBeNull();
  });

  it("adds a real empty question with a stable id and no fake content", () => {
    const onState = vi.fn();
    render(<Harness initial={[]} onState={onState} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));

    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Tipo de pregunta 1" })).toHaveValue("open");

    const next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next).toHaveLength(1);
    expect(next[0].options).toEqual([]);
    expect(next[0].correctOptionId).toBe("");
  });

  it("edits the prompt and the type without regenerating the question id", () => {
    const onState = vi.fn();
    render(<Harness initial={[question({ type: "open", options: [] })]} onState={onState} />);
    fireEvent.click(trigger(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "Cuéntanos sobre ti" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de pregunta 1" }), {
      target: { value: "single_choice_informative" },
    });

    const next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next[0].prompt).toBe("Cuéntanos sobre ti");
    expect(next[0].type).toBe("single_choice_informative");
    expect(next[0].id).toBe(QUESTION_ID);
  });

  it("shows and edits the two options of a single-choice question", () => {
    render(<Harness initial={[question()]} />);
    fireEvent.click(trigger(1));

    expect(screen.getByRole("textbox", { name: "Opción 1.1" })).toHaveValue("Remoto");
    fireEvent.change(screen.getByRole("textbox", { name: "Opción 1.2" }), {
      target: { value: "Presencial" },
    });
    expect(screen.getByRole("textbox", { name: "Opción 1.2" })).toHaveValue("Presencial");
  });

  it("adds and removes options, preserving the remaining ids", () => {
    const onState = vi.fn();
    render(<Harness initial={[question()]} onState={onState} />);
    fireEvent.click(trigger(1));

    fireEvent.click(screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }));
    let next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next[0].options.map((option) => option.id)).toEqual([OID1, OID2, next[0].options[2].id]);

    fireEvent.click(screen.getByRole("button", { name: "Quitar opción 1.1" }));
    next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next[0].options.map((option) => option.id)).toEqual([OID2, next[0].options[1].id]);
  });

  it("disables the add-option control at the eight-option bound", () => {
    const full = question({
      options: Array.from({ length: SCREENING_OPTIONS_MAX }, (_, index) => ({
        id: index === 0 ? OID1 : `option-${index + 1}-uuid-0000-000000000000`.slice(0, 36),
        label: `Opción ${index + 1}`,
      })),
    });

    render(<Harness initial={[full]} />);
    fireEvent.click(trigger(1));

    expect(
      screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }),
    ).toBeDisabled();
  });

  it("picks exactly one correct answer and clears a removed reference", () => {
    const onState = vi.fn();
    render(
      <Harness
        initial={[question({ type: "single_choice_evaluated", correctOptionId: "" })]}
        onState={onState}
      />,
    );
    fireEvent.click(trigger(1));

    const picker = screen.getByRole("combobox", {
      name: "Respuesta correcta de la pregunta 1",
    });
    expect(picker).toHaveValue("");

    fireEvent.change(picker, { target: { value: OID1 } });
    let next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next[0].correctOptionId).toBe(OID1);

    fireEvent.click(screen.getByRole("button", { name: "Quitar opción 1.1" }));
    next = onState.mock.calls.at(-1)?.[0] as DraftScreeningV2State;
    expect(next[0].correctOptionId).toBe("");
    expect(next[0].options.map((option) => option.id)).toEqual([OID2]);
  });

  it("hides options for an open question and restores them on a type switch", () => {
    render(<Harness initial={[question({ type: "open", correctOptionId: "" })]} />);
    fireEvent.click(trigger(1));

    expect(screen.queryByRole("textbox", { name: "Opción 1.1" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de pregunta 1" }), {
      target: { value: "single_choice_informative" },
    });
    expect(screen.getByRole("textbox", { name: "Opción 1.1" })).toHaveValue("Remoto");
    expect(screen.getByRole("textbox", { name: "Opción 1.2" })).toHaveValue("Híbrido");
  });

  it("associates a screening prompt error with its visible feedback", () => {
    render(
      <Harness
        initial={[question({ type: "open", options: [], prompt: "" })]}
        errors={{ "screening_questions.0.prompt": SCREENING_EMPTY_ERROR }}
      />,
    );
    fireEvent.click(trigger(1));

    const promptInput = screen.getByRole("textbox", { name: "Pregunta 1" });
    expect(promptInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = promptInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(SCREENING_EMPTY_ERROR);
  });

  it("disables the add-question control at the hundred-question bound", () => {
    const full = Array.from({ length: SCREENING_QUESTIONS_MAX }, () =>
      createScreeningQuestionV2(),
    );

    render(<Harness initial={full} />);

    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeDisabled();
  });

  it("gives every independent control a >=40px structural height guarantee", () => {
    // jsdom has no layout, so this asserts the deterministic class contract
    // (h-10/min-h-10/size-10) rather than measuring real geometry.
    const guarantee = (element: HTMLElement) =>
      /(?:^|\s)(?:h-(?:10|11|12)|min-h-(?:10|11|12)|size-(?:10|11|12))(?:\s|$)/.test(
        element.className,
      );

    render(
      <Harness
        initial={[question({ type: "single_choice_evaluated", correctOptionId: OID1 })]}
      />,
    );
    fireEvent.click(trigger(1));

    const controls: HTMLElement[] = [
      trigger(1),
      screen.getByRole("textbox", { name: "Opción 1.1" }),
      screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }),
      screen.getByRole("button", { name: "Agregar pregunta" }),
      screen.getByRole("button", { name: "Quitar opción 1.1" }),
      screen.getByRole("button", { name: "Quitar pregunta 1" }),
      screen.getByRole("combobox", { name: "Tipo de pregunta 1" }),
      screen.getByRole("combobox", { name: "Respuesta correcta de la pregunta 1" }),
    ];
    for (const control of controls) {
      const name = control.getAttribute("aria-label") ?? control.getAttribute("name");
      expect(guarantee(control), `${name} height guarantee`).toBe(true);
    }

    // The prompt textarea already guarantees the target natively.
    expect(screen.getByRole("textbox", { name: "Pregunta 1" }).className).toContain(
      "min-h-16",
    );
  });
});
