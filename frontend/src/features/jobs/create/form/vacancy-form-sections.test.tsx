import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps, ReactNode } from "react";
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
import { VACANCY_STEP_IDS, stepTitle } from "./step-model";
import type { VacancyStepId } from "./step-model";

// Layered unit boundary: DatePickerField owns its behavior in its own focused
// suite, so this file replaces the whole field with a wiring probe that reports
// the id/aria-labelledby it received and emits one fixed civil date.
vi.mock("@/components/ui/date-picker-field", () => ({
  DatePickerField: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    <button
      type="button"
      id={id}
      data-value={value}
      onClick={() => onChange("2026-12-31")}
    >
      Fecha de cierre
    </button>
  ),
}));

/**
 * Base UI's portaled select popup waits on browser positioning that jsdom cannot
 * complete, so this layered adapter keeps the section's real controlled
 * value/onValueChange contract executable.
 */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Option = Readonly<{ value: string; label: string }>;
  type State = Readonly<{
    items: readonly Option[];
    value: string | null;
    onValueChange: (value: string) => void;
  }>;
  type RootProps = Readonly<{
    items?: readonly Option[];
    value?: string | null;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }>;
  const Context = React.createContext<State | null>(null);
  const NullPart = () => null;

  function Select({
    items = [],
    value = null,
    onValueChange = () => undefined,
    children,
  }: RootProps) {
    return (
      <Context.Provider value={{ items, value, onValueChange }}>
        {children}
      </Context.Provider>
    );
  }

  function SelectTrigger(props: ComponentProps<"select">) {
    const state = React.useContext(Context);
    if (!state) throw new Error("SelectTrigger requires Select");
    return (
      <select
        {...props}
        data-slot="select-trigger"
        value={state.value ?? ""}
        onChange={(event) => state.onValueChange(event.target.value)}
      >
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

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "vacancy-form-sections.tsx"), "utf8");

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

function renderStep(
  step: VacancyStepId,
  overrides: {
    values?: Partial<VacancyFormValues>;
    errors?: VacancyFieldErrors;
    prototype?: Partial<VacancyPrototypeValues>;
  } = {},
) {
  const onChange = vi.fn();
  const onChangePrototype = vi.fn();
  const onEditStep = vi.fn();
  const values: VacancyFormValues = { ...INITIAL_VALUES, ...overrides.values };
  const prototypeValues: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides.prototype,
  };

  const view = render(
    <VacancyFormSections
      step={step}
      values={values}
      errors={overrides.errors ?? {}}
      onChange={onChange}
      prototypeValues={prototypeValues}
      onChangePrototype={onChangePrototype}
      onEditStep={onEditStep}
    />,
  );

  return { ...view, values, prototypeValues, onChange, onChangePrototype, onEditStep };
}

function textbox(name: string): HTMLTextAreaElement | HTMLInputElement {
  return screen.getByRole("textbox", {
    name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  }) as HTMLTextAreaElement;
}

describe("VacancyFormSections step switch", () => {
  it("renders only the current step and names it with one real heading", () => {
    renderStep("basic-information");

    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("basic-information") }),
    ).toBeVisible();
    expect(textbox("Título del puesto")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Área o departamento" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toBeVisible();

    // No other step's fields are mounted.
    expect(screen.queryByRole("textbox", { name: "Descripción del puesto" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Salario mínimo" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Frecuencia de pago" })).toBeNull();
    expect(screen.queryByText("Sin preguntas de filtro")).toBeNull();
    expect(document.querySelector("[data-pf-review-step]")).toBeNull();
  });

  it("renders the role profile step with the rich description, skills, and languages", () => {
    renderStep("role-profile", {
      prototype: {
        skills: ["React", "TypeScript"],
        languages: [{ id: "language-1", language: "Inglés", level: "B2" }],
      },
    });

    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("role-profile") }),
    ).toBeVisible();
    expect(textbox("Descripción del puesto").tagName).toBe("TEXTAREA");
    expect(textbox("Requisitos obligatorios")).toBeVisible();
    expect(textbox("Requisitos deseables")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Habilidades y tecnologías" })).toBeVisible();
    expect(screen.getByLabelText("Idioma 1")).toHaveValue("Inglés");
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeEnabled();

    // Step one and step three stay out of the tree.
    expect(screen.queryByRole("textbox", { name: "Título del puesto" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Moneda" })).toBeNull();
  });

  it("renders the conditions step with salary, benefits, closing date, and questions", () => {
    renderStep("conditions-process");

    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("conditions-process") }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Moneda" })).toBeVisible();
    expect(textbox("Salario mínimo")).toBeVisible();
    expect(textbox("Salario máximo")).toBeVisible();
    expect(screen.getByRole("group", { name: "Beneficios" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Frecuencia de pago" })).toBeVisible();
    expect(screen.getByLabelText(/fecha de cierre/iu)).toBeVisible();
    expect(screen.getByText("Sin preguntas de filtro")).toBeVisible();

    expect(screen.queryByRole("textbox", { name: "Título del puesto" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Descripción del puesto" })).toBeNull();
  });

  it("renders the review step with grouped summaries, edit actions, and the rail", () => {
    renderStep("review", {
      values: { title: "Backend Developer", workMode: "remote", employmentType: "full_time", seniority: "senior" },
      prototype: { department: "Ingeniería" },
    });

    const review = document.querySelector("[data-pf-review-step]");
    expect(review).not.toBeNull();
    // No editable contract field of the earlier steps is mounted on review.
    expect(screen.queryByRole("textbox", { name: "Título del puesto" })).toBeNull();
    // The preview and save rail lives only here.
    expect(screen.getByRole("complementary", { name: "Vista previa y guardado" })).toBeVisible();
    expect(screen.getByRole("button", { name: /guardar borrador/i })).toHaveAttribute("type", "submit");
    // One grouped summary card per editable step, each with one edit action.
    expect(document.querySelectorAll("[data-pf-review-group]")).toHaveLength(3);
    expect(
      screen.getAllByRole("button", { name: /^Editar / }),
    ).toHaveLength(3);
    const basicGroup = document.querySelector(
      "[data-pf-review-group='basic-information']",
    ) as HTMLElement;
    expect(within(basicGroup).getByText("Backend Developer")).toBeVisible();
    expect(within(basicGroup).getByText("Ingeniería")).toBeVisible();
    // The step heading is the review focus target, never a tab stop.
    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("review") }),
    ).toHaveAttribute("tabindex", "-1");
  });
});

describe("VacancyFormSections callback routing", () => {
  it("routes contract changes only through the contract callback", () => {
    const { onChange, onChangePrototype } = renderStep("basic-information");

    fireEvent.change(textbox("Título del puesto"), {
      target: { value: "Backend Developer" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("title", "Backend Developer");
    expect(onChangePrototype).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "Modalidad" }), {
      target: { value: "remote" },
    });
    expect(onChange).toHaveBeenLastCalledWith("workMode", "remote");
    expect(onChangePrototype).not.toHaveBeenCalled();
  });

  it("routes the department and the rich description through prototype state", () => {
    const first = renderStep("basic-information");
    fireEvent.change(screen.getByRole("combobox", { name: "Área o departamento" }), {
      target: { value: "Producto" },
    });
    expect(first.onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ department: "Producto" }),
    );
    expect(first.onChange).not.toHaveBeenCalled();

    cleanup();
    const second = renderStep("role-profile", {
      prototype: { descriptionRich: "**Fuerte** experiencia" },
    });
    expect(textbox("Descripción del puesto")).toHaveValue("**Fuerte** experiencia");
    fireEvent.change(textbox("Descripción del puesto"), {
      target: { value: "**Fuerte** y claro" },
    });
    expect(second.onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ descriptionRich: "**Fuerte** y claro" }),
    );
    expect(second.onChange).not.toHaveBeenCalled();
  });

  it("routes prototype changes only through the prototype callback", () => {
    const { onChange, onChangePrototype } = renderStep("conditions-process", {
      prototype: { benefits: ["health_insurance", "annual_bonus"] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Quitar Seguro de salud" }));
    expect(onChangePrototype).toHaveBeenCalledTimes(1);
    expect(onChangePrototype.mock.calls[0][0].benefits).toEqual(["annual_bonus"]);

    fireEvent.click(screen.getByLabelText(/fecha de cierre/iu));
    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({ closingDate: "2026-12-31" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    expect(onChangePrototype).toHaveBeenLastCalledWith(
      expect.objectContaining({
        screeningQuestions: [{ id: "question-1", prompt: "" }],
      }),
    );
    // No prototype interaction can reach the contract state.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("forwards contract errors only to the fields that own them", () => {
    renderStep("basic-information", {
      errors: {
        title: "Ingresa un título para la vacante.",
        description: "Ingresa una descripción para la vacante.",
      },
    });

    expect(textbox("Título del puesto")).toHaveAttribute("aria-invalid", "true");
    // The description error belongs to another step and must not leak here.
    expect(screen.queryByText("Ingresa una descripción para la vacante.")).toBeNull();

    cleanup();
    renderStep("role-profile", {
      errors: { description: "Ingresa una descripción para la vacante." },
    });
    expect(textbox("Descripción del puesto")).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-error",
    );
  });

  it("reports the salary error only on the conditions step", () => {
    renderStep("conditions-process", {
      errors: { salary_max: "El salario máximo debe ser mayor o igual al salario mínimo." },
    });

    expect(textbox("Salario máximo")).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("El salario máximo debe ser mayor o igual al salario mínimo."),
    ).toBeVisible();
  });
});

describe("VacancyFormSections inherited limits", () => {
  it("inherits the prototype limits instead of re-implementing them", () => {
    const questions = Array.from({ length: 3 }, (_, index) => ({
      id: `question-${index + 1}`,
      prompt: `¿Pregunta ${index + 1}?`,
    }));
    const languages = ["Inglés", "Portugués", "Francés"].map((language, index) => ({
      id: `language-${index + 1}`,
      language,
      level: "B1" as const,
    }));

    cleanup();
    renderStep("conditions-process", { prototype: { screeningQuestions: questions } });
    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeDisabled();
    expect(screen.getAllByRole("textbox", { name: /^Pregunta /u })).toHaveLength(3);

    cleanup();
    renderStep("role-profile", { prototype: { languages } });
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeDisabled();
    expect(screen.getAllByLabelText(/^Idioma /u)).toHaveLength(MAX_LANGUAGES);
  });
});

describe("VacancyFormSections boundaries", () => {
  it("composes the partitioned section modules across the four steps", () => {
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
    expect(source).toContain("from \"./review-step\"");
    expect(source).not.toContain("section-navigator");
    expect(source).not.toContain("draft-rail\""); // the rail lives behind review-step
  });

  it("renders exactly one step card for the editable steps", () => {
    const { container } = renderStep("basic-information");
    const cards = container.querySelectorAll("[data-pf-section-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("id", "vacancy-step-basic-information");
    // The step switch is exhaustive over the four canonical ids.
    expect(VACANCY_STEP_IDS).toHaveLength(4);
  });

  it("owns no save, request, schema, or credential concern", () => {
    expect(source).not.toMatch(/attemptDraftSave|createJobRequestSchema|schemas|zod/);
    expect(source).not.toMatch(/createJob|requestJson|lib\/api/);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("keeps every extracted form module free of request and transport APIs", () => {
    const modules = readdirSync(FORM_DIR).filter(
      (entry) => !entry.endsWith(".test.tsx") && !entry.endsWith(".test.ts"),
    );
    expect(modules.length).toBeGreaterThan(0);

    for (const fileName of modules) {
      const text = readFileSync(join(FORM_DIR, fileName), "utf8");
      expect(text, fileName).not.toMatch(/\bcreateJob\s*\(|from ["'][^"']*\/createJob["']/);
      expect(text, fileName).not.toMatch(/lib\/api\/|lib\/env\/server|next\/headers|\bfetch\s*\(/);
      expect(text, fileName).not.toMatch(/\bcookies?\b|\bsession\b|\bbearer\b|\baccessToken\b|\bgetToken\b/i);
    }
  });
});
