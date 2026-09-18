import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { VacancyFormSections } from "./vacancy-form-sections";
import { INITIAL_VALUES } from "./model";
import type { VacancyFormValues, VacancyFieldErrors } from "./model";
import { INITIAL_PROTOTYPE_VALUES, MAX_LANGUAGES } from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "vacancy-form-sections.tsx"), "utf8");

const SECTION_HEADINGS = [
  "Información básica",
  "Compensación",
  "Descripción y requisitos",
  "Estrategia de contratación",
  "Beneficios y frecuencia de pago",
  "Preguntas de filtro",
];

// jsdom lacks the layout and pointer APIs the Base UI primitives read.
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

function stubBrowserApis() {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
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

beforeEach(stubBrowserApis);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSections(
  overrides: {
    values?: Partial<VacancyFormValues>;
    errors?: VacancyFieldErrors;
    prototype?: Partial<VacancyPrototypeValues>;
  } = {},
) {
  const onChange = vi.fn();
  const onChangePrototype = vi.fn();
  const values: VacancyFormValues = { ...INITIAL_VALUES, ...overrides.values };
  const prototypeValues: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides.prototype,
  };

  const view = render(
    <VacancyFormSections
      values={values}
      errors={overrides.errors ?? {}}
      onChange={onChange}
      prototypeValues={prototypeValues}
      onChangePrototype={onChangePrototype}
    />,
  );

  return { ...view, values, prototypeValues, onChange, onChangePrototype };
}

function textbox(name: string): HTMLTextAreaElement | HTMLInputElement {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

describe("VacancyFormSections composition", () => {
  it("composes every enriched Spanish section in one boundary", () => {
    renderSections();

    for (const heading of SECTION_HEADINGS) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }

    // The requirements composition owns the contract description field, so the
    // superseded plain-text card is out of the active tree.
    expect(textbox("Descripción del puesto").tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("heading", { name: "Descripción" })).toBeNull();
  });

  it("exposes the enriched local-only surfaces with their catalogs", () => {
    renderSections({
      prototype: {
        skills: ["React", "TypeScript"],
        languages: [{ id: "language-1", language: "Inglés", level: "B2" }],
      },
    });

    expect(
      screen.getByRole("combobox", { name: "Área o departamento" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Habilidades y tecnologías" }),
    ).toBeVisible();

    const chips = document.querySelector('[data-slot="combobox-chips"]');
    expect(chips).not.toBeNull();
    expect(
      within(chips as HTMLElement).getByRole("button", { name: "Quitar React" }),
    ).toBeVisible();

    expect(screen.getByLabelText("Idioma 1")).toHaveValue("Inglés");
    expect(screen.getByRole("combobox", { name: "Nivel 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeEnabled();
    expect(screen.getByLabelText(/fecha de cierre/iu)).toHaveAttribute(
      "type",
      "date",
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
    expect(screen.getByRole("group", { name: "Frecuencia de pago" })).toBeVisible();
    expect(screen.getByText("Sin preguntas de filtro")).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeEnabled();
  });

  it("inherits the prototype limits instead of re-implementing them", () => {
    const questions = Array.from({ length: 3 }, (_, index) => ({
      id: `question-${index + 1}`,
      prompt: `¿Pregunta ${index + 1}?`,
    }));
    const languages = ["Inglés", "Portugués", "Francés"].map(
      (language, index) => ({
        id: `language-${index + 1}`,
        language,
        level: "B1" as const,
      }),
    );

    renderSections({ prototype: { screeningQuestions: questions, languages } });

    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeDisabled();
    expect(screen.getAllByRole("textbox", { name: /^Pregunta /u })).toHaveLength(3);
    expect(screen.getAllByLabelText(/^Idioma /u)).toHaveLength(MAX_LANGUAGES);
  });

  it("renders the rich formatting surfaces without claiming a saved format", () => {
    renderSections();

    for (const label of [
      "Descripción del puesto",
      "Requisitos obligatorios",
      "Requisitos deseables",
    ]) {
      expect(
        screen.getByRole("toolbar", { name: `Formato de ${label}` }),
      ).toBeVisible();
    }
    expect(
      screen.getAllByText("Formato visual de prototipo; todavía no se guarda."),
    ).toHaveLength(3);
    expect(screen.getAllByText("Prototipo")).toHaveLength(2);
  });

  it("forwards contract errors to the fields that own them", () => {
    renderSections({
      errors: {
        title: "Ingresá un título para la vacante.",
        description: "Ingresá una descripción para la vacante.",
      },
    });

    expect(textbox("Título del puesto")).toHaveAttribute("aria-invalid", "true");
    expect(textbox("Descripción del puesto")).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-disclosure vacancy-description-error",
    );
  });
});

describe("VacancyFormSections callback routing", () => {
  it("routes contract changes only through the contract callback", () => {
    const { onChange, onChangePrototype } = renderSections();

    fireEvent.change(textbox("Título del puesto"), {
      target: { value: "Backend Developer" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("title", "Backend Developer");
    expect(onChangePrototype).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remoto" }));
    expect(onChange).toHaveBeenLastCalledWith("workMode", "remote");
    expect(onChangePrototype).not.toHaveBeenCalled();
  });

  it("routes the rich description through prototype state and renders its local value", () => {
    const { onChange, onChangePrototype } = renderSections({
      prototype: { descriptionRich: "**Fuerte** experiencia" },
    });

    // The tokenized value owns the editing surface, not the contract field.
    expect(textbox("Descripción del puesto")).toHaveValue(
      "**Fuerte** experiencia",
    );

    fireEvent.change(textbox("Descripción del puesto"), {
      target: { value: "**Fuerte** y claro" },
    });

    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ descriptionRich: "**Fuerte** y claro" }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes prototype changes only through the prototype callback", () => {
    const { onChange, onChangePrototype } = renderSections();

    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro de salud" }));
    expect(onChangePrototype).toHaveBeenCalledTimes(1);
    expect(onChangePrototype.mock.calls[0][0].benefits).toEqual([
      "health_insurance",
    ]);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(textbox("Requisitos obligatorios"), {
      target: { value: "5 años con React." },
    });
    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ requiredRequirements: "5 años con React." }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screeningQuestions: [{ id: "question-1", prompt: "" }],
      }),
    );

    fireEvent.change(screen.getByLabelText(/fecha de cierre/iu), {
      target: { value: "2026-12-31" },
    });
    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ closingDate: "2026-12-31" }),
    );
    // No prototype interaction can reach the contract state.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("VacancyFormSections boundaries", () => {
  it("lays the sections out in one column that becomes two at xl", () => {
    const { container } = renderSections();

    const grid = container.querySelector("[data-pf-form-sections]");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("xl:grid-cols-2");
    // Requirements and screening span the full width of the two-column grid.
    expect(container.querySelectorAll('[class*="xl:col-span-2"]')).toHaveLength(2);
  });

  it("composes the six verified section modules and the superseded one is gone", () => {
    for (const sectionModule of [
      "basic-information-section",
      "compensation-section",
      "requirements-section",
      "strategy-section",
      "benefits-section",
      "screening-section",
    ]) {
      expect(source).toContain(`from "./${sectionModule}"`);
    }
    expect(source).not.toContain("description-section");
  });

  it("records the superseded description module as deleted and unreferenced", () => {
    expect(existsSync(join(FORM_DIR, "description-section.tsx"))).toBe(false);

    for (const entry of readdirSync(FORM_DIR)) {
      if (entry.endsWith(".test.tsx") || entry === "description-section.tsx") continue;
      expect(
        readFileSync(join(FORM_DIR, entry), "utf8"),
        `${entry} must not reference the deleted description module`,
      ).not.toContain("description-section");
    }
  });

  it("owns no save, request, schema, or credential concern", () => {
    expect(source).not.toMatch(/attemptDraftSave|createJobRequestSchema|schemas|zod/);
    expect(source).not.toMatch(/createJob|requestJson|lib\/api/);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source.split("\n").length).toBeLessThanOrEqual(220);
  });
});
