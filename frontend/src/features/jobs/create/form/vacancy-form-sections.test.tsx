import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { VacancyFormSections } from "./vacancy-form-sections";
import { INITIAL_VALUES } from "./model";
import type { VacancyFormValues, VacancyFieldErrors } from "./model";
import { VACANCY_FORM_SECTIONS, sectionAnchorId } from "./section-metadata";
import { INITIAL_PROTOTYPE_VALUES, MAX_LANGUAGES } from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";

// Layered unit boundary: DatePickerField owns its behavior in its own focused
// suite, so this file replaces the whole field with a wiring probe that reports
// the id/aria-labelledby it received and emits one fixed civil date.
vi.mock("@/components/ui/date-picker-field", () => ({
  DatePickerField: ({
    id,
    "aria-labelledby": labelledBy,
    value,
    onChange,
  }: {
    id: string;
    "aria-labelledby"?: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    <button
      type="button"
      id={id}
      aria-labelledby={labelledBy}
      data-value={value}
      onClick={() => onChange("2026-12-31")}
    >
      Fecha de cierre
    </button>
  ),
}));

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
    // No native date control remains: the field is the reusable DatePickerField.
    const closingDate = screen.getByLabelText(/fecha de cierre/iu);
    expect(closingDate).not.toHaveAttribute("type", "date");
    expect(closingDate.tagName).toBe("BUTTON");

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

    fireEvent.click(screen.getByLabelText(/fecha de cierre/iu));
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

  it("retires the legacy section shell now that every section migrated", () => {
    const controls = readFileSync(join(FORM_DIR, "controls.tsx"), "utf8");

    expect(controls).not.toMatch(/export function FormSection\(/);
    expect(controls).not.toMatch(/FormSectionProps/);
    expect(controls).not.toMatch(/from "@\/components\/ui\/card"/);

    for (const entry of readdirSync(FORM_DIR)) {
      if (!entry.endsWith(".tsx") || entry.endsWith(".test.tsx")) continue;
      expect(
        readFileSync(join(FORM_DIR, entry), "utf8"),
        `${entry} must not use the retired legacy section shell`,
      ).not.toMatch(/<FormSection[\s>]|FormSectionProps/);
    }
  });

  it("owns no save, request, schema, or credential concern", () => {
    expect(source).not.toMatch(/attemptDraftSave|createJobRequestSchema|schemas|zod/);
    expect(source).not.toMatch(/createJob|requestJson|lib\/api/);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source.split("\n").length).toBeLessThanOrEqual(220);
  });
});

describe("VacancyFormSections layout foundation", () => {
  it("renders exactly one foundation card per section with its canonical anchor and title", () => {
    const { container } = renderSections();

    // Every section migrated, so the legacy chrome is gone from the whole tree.
    const foundation = container.querySelectorAll("[data-pf-section-card]");
    expect(foundation).toHaveLength(6);
    expect(VACANCY_FORM_SECTIONS).toHaveLength(6);
    expect(Array.from(foundation, (card) => card.id)).toEqual(
      VACANCY_FORM_SECTIONS.map((section) => sectionAnchorId(section.id)),
    );
    for (const card of foundation) {
      expect(card).toHaveAttribute("data-size", "sm");
      expect(card.className).toContain("h-fit");
    }

    // No card without the new marker and no legacy icon chip survives.
    for (const card of container.querySelectorAll('[data-slot="card"]')) {
      expect(card).toHaveAttribute("data-pf-section-card");
      expect(card.querySelector(".size-8.rounded-xl")).toBeNull();
    }

    // Every heading sits inside the card anchored for its own section.
    for (const section of VACANCY_FORM_SECTIONS) {
      const card = screen
        .getByRole("heading", { level: 2, name: section.title })
        .closest('[data-slot="card"]');
      expect(card?.id).toBe(sectionAnchorId(section.id));
    }

    // A stretched grid row is what inflated Compensación into a blank panel.
    const grid = container.querySelector("[data-pf-form-sections]");
    expect(grid?.className).toContain("items-start");

    // Canonical order, exact Spanish title, one heading per section.
    const titles = VACANCY_FORM_SECTIONS.map((section) => section.title);
    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent ?? "")
      .filter((text) => titles.includes(text));
    expect(headings).toEqual(titles);
  });

  it("reflows the choice grids and reports the Jornada contract value", async () => {
    const { container, onChange } = renderSections();

    // Modalidad, Jornada, Seniority, and Moneda own a shared responsive grid.
    const grids = container.querySelectorAll("[data-pf-choice-grid]");
    expect(grids).toHaveLength(4);
    for (const grid of grids) expect(grid.className).toContain("grid-cols-1");

    // The column count is declared per section: Jornada two, Modalidad three.
    const jornada = screen.getByRole("group", { name: "Jornada" });
    expect(jornada.className).toContain("sm:grid-cols-2");
    const modalidad = screen.getByRole("group", { name: "Modalidad" });
    expect(modalidad.className).toContain("sm:grid-cols-3");

    const fullTime = within(jornada).getByRole("button", {
      name: "Tiempo completo",
    });
    expect(fullTime.className).toContain("min-w-0");
    expect(fullTime.className).toContain("whitespace-normal");
    expect(fullTime.className).not.toContain("whitespace-nowrap");

    // Same control and contract value as before the migration.
    fireEvent.click(fullTime);
    expect(onChange).toHaveBeenCalledWith("employmentType", "full_time");

    // One roving tab stop; arrows move focus inside the same choice set.
    const choices = within(jornada).getAllByRole("button");
    expect(
      choices.filter((choice) => choice.getAttribute("tabindex") !== "-1"),
    ).toHaveLength(1);
    choices[0].focus();
    fireEvent.keyDown(choices[0], { key: "ArrowRight" });
    await waitFor(() => expect(choices[1]).toHaveFocus());
  });

  it("keeps the enum error wiring on the migrated choice grid", () => {
    renderSections({
      errors: { employment_type: "Elegí una jornada de trabajo." },
    });

    const jornada = screen.getByRole("group", { name: "Jornada" });
    expect(jornada).toHaveAttribute("id", "vacancy-employment-type");
    expect(jornada).toHaveAttribute("aria-invalid", "true");
    expect(jornada).toHaveAttribute(
      "aria-describedby",
      "vacancy-employment-type-error",
    );
    expect(
      document.getElementById("vacancy-employment-type-error"),
    ).toHaveTextContent("Elegí una jornada de trabajo.");
  });
});
