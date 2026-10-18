import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import type { CandidateScreeningQuestion } from "../screening-v2/model";
import { DraftQuestionnairePreview } from "./draft-questionnaire-preview";

/**
 * The preview is a purely local simulation over the allowlisted candidate
 * projection: no employer variant, no answer key, no score, no request and no
 * storage. The `Questionnaire` primitive renders a native `<form>`, so these
 * tests also pin the contract that the preview must be mounted as a sibling of
 * the draft wizard form, never inside it.
 */

const open = (id: string, prompt: string): CandidateScreeningQuestion => ({
  id,
  type: "open",
  prompt,
});

const singleChoice = (
  id: string,
  prompt: string,
  options: { id: string; label: string }[],
): CandidateScreeningQuestion => ({ id, type: "single_choice", prompt, options });

const LOCAL_NOTICE = "Vista previa local. Tus respuestas no se envían ni se guardan.";
const RESET_NOTICE = "Al editar las preguntas, la simulación se reinicia.";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DraftQuestionnairePreview empty state", () => {
  it("renders an honest empty state and never a form when there are no questions", () => {
    const { container } = render(<DraftQuestionnairePreview questions={[]} />);

    expect(
      screen.getByRole("heading", { name: "Simular cuestionario" }),
    ).toBeInTheDocument();
    expect(screen.getByText(LOCAL_NOTICE)).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay preguntas")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[data-slot="questionnaire"]')).toBeNull();
    expect(screen.queryByText(/^Pregunta \d+ de \d+$/)).toBeNull();
  });
});

describe("DraftQuestionnairePreview simulation", () => {
  it("stacks navigation on mobile without shrinking independent controls", async () => {
    const { container } = render(<DraftQuestionnairePreview questions={[open("q1", "Pregunta"), open("q2", "Otra")]} />);
    expect(container.querySelector('[data-slot="questionnaire-actions"]')).toHaveClass("grid-cols-1");
    for (const name of ["Omitir", "Siguiente"]) expect(screen.getByRole("button", { name })).toHaveClass("w-full", "sm:w-auto");
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("button", { name: "Omitir" })).toHaveAttribute("data-variant", "outline");
    await userEvent.setup().click(screen.getByRole("button", { name: "Omitir" }));
    for (const name of ["Anterior", "Finalizar simulación"]) expect(screen.getByRole("button", { name })).toHaveClass("w-full", "sm:w-auto");
  });
  it("renders three questions in order and advances with the official navigation", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DraftQuestionnairePreview
        questions={[
          open("q1", "Describe tu experiencia"),
          singleChoice("q2", "¿Qué modalidad prefieres?", [
            { id: "o1", label: "Remoto" },
            { id: "o2", label: "Híbrido" },
          ]),
          open("q3", "¿Cuál es tu expectativa salarial?"),
        ]}
      />,
    );

    const items = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-slot="questionnaire-item"]'));

    expect(screen.getByText("Pregunta 1 de 3")).toBeInTheDocument();
    expect(items()).toHaveLength(3);
    expect(items().map((item) => item.hidden)).toEqual([false, true, true]);
    expect(screen.getByRole("group", { name: "Describe tu experiencia" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Omitir" }));

    expect(screen.getByText("Pregunta 2 de 3")).toBeInTheDocument();
    expect(items().map((item) => item.hidden)).toEqual([true, false, true]);
    expect(screen.getByRole("group", { name: "¿Qué modalidad prefieres?" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Omitir" }));

    expect(screen.getByText("Pregunta 3 de 3")).toBeInTheDocument();
    expect(items().map((item) => item.hidden)).toEqual([true, true, false]);
    expect(
      screen.getByRole("group", { name: "¿Cuál es tu expectativa salarial?" }),
    ).toBeVisible();
  });

  it("keeps the raw spaces typed in an open question and advances with Siguiente", async () => {
    const user = userEvent.setup();
    render(
      <DraftQuestionnairePreview
        questions={[open("q1", "Pregunta abierta"), open("q2", "Otra pregunta")]}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Pregunta abierta" });
    await user.type(input, "  hola mundo  ");
    expect(input).toHaveValue("  hola mundo  ");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Pregunta 2 de 2")).toBeInTheDocument();
  });

  it("keeps only one selected choice in a single-choice question", async () => {
    const user = userEvent.setup();
    render(
      <DraftQuestionnairePreview
        questions={[
          singleChoice("q1", "¿Qué modalidad prefieres?", [
            { id: "o1", label: "Remoto" },
            { id: "o2", label: "Híbrido" },
          ]),
        ]}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Remoto" }));
    expect(screen.getByRole("radio", { name: "Remoto" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Híbrido" })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Híbrido" }));
    expect(screen.getByRole("radio", { name: "Híbrido" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Remoto" })).not.toBeChecked();
  });

  it("preserves choices and open answers across back-and-forward navigation", async () => {
    const user = userEvent.setup();
    render(
      <DraftQuestionnairePreview
        questions={[
          singleChoice("q1", "¿Qué modalidad prefieres?", [
            { id: "o1", label: "Remoto" },
            { id: "o2", label: "Híbrido" },
          ]),
          open("q2", "Comentario"),
          open("q3", "Cierre"),
        ]}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Híbrido" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Pregunta 2 de 3")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Comentario" }), "Mi comentario");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Pregunta 3 de 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(screen.getByText("Pregunta 2 de 3")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Comentario" })).toHaveValue("Mi comentario");

    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(screen.getByText("Pregunta 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Híbrido" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Remoto" })).not.toBeChecked();
  });

  it("prevents the native submit without navigating, fetching or storing", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<DraftQuestionnairePreview questions={[open("q1", "Pregunta única")]} />);

    await user.type(screen.getByRole("textbox", { name: "Pregunta única" }), "Respuesta");
    const hrefBefore = window.location.href;

    await user.click(screen.getByRole("button", { name: "Finalizar simulación" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(hrefBefore);
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/not implemented/i),
      expect.anything(),
    );
    expect(
      screen.queryByText(/aprobad|rechazad|puntaj|puntuaci[oó]n|resultado final/i),
    ).toBeNull();
  });

  it("exposes no answer key, score, checkbox nor hidden input in the DOM", () => {
    const { container } = render(
      <DraftQuestionnairePreview
        questions={[
          singleChoice("q1", "¿Qué modalidad prefieres?", [
            { id: "o1", label: "Remoto" },
            { id: "o2", label: "Híbrido" },
          ]),
          open("q2", "Comentario"),
        ]}
      />,
    );

    expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(container.innerHTML).not.toMatch(/correct_option_id|score|evaluated/i);
  });
});

describe("DraftQuestionnairePreview edit reset", () => {
  it("resets the simulation and warns when the questions change", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DraftQuestionnairePreview questions={[open("q1", "Pregunta original")]} />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Pregunta original" }),
      "respuesta vieja",
    );
    expect(screen.queryByText(RESET_NOTICE)).toBeNull();

    rerender(<DraftQuestionnairePreview questions={[open("q2", "Pregunta nueva")]} />);

    expect(screen.getByText(RESET_NOTICE)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("respuesta vieja")).toBeNull();
    expect(screen.queryByText("Pregunta original")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Pregunta nueva" })).toHaveValue("");
  });
});

describe("DraftQuestionnairePreview form boundary", () => {
  it("renders its own form as a sibling and never nested inside another form", () => {
    const { container } = render(
      <div>
        <form aria-label="Formulario del asistente" />
        <DraftQuestionnairePreview questions={[open("q1", "Pregunta")]} />
      </div>,
    );

    const previewForm = container.querySelector('form[data-slot="questionnaire"]');
    expect(previewForm).not.toBeNull();
    expect(previewForm?.closest("form")).toBe(previewForm);
    expect(container.querySelectorAll("form")).toHaveLength(2);
    expect(container.querySelector("form form")).toBeNull();
  });
});
