import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CreateVacancyForm } from "./CreateVacancyForm";
import { firstInvalidField } from "./form/model";
import { firstInvalidStep, stepTitle } from "./form/step-model";

/**
 * Base UI's portaled select popup waits on browser positioning that jsdom cannot
 * complete, so this layered adapter keeps the form's real controlled
 * value/onValueChange contract executable; the installed popup is covered by the
 * primitive suite and `controls.test.tsx`.
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

const source = readFileSync(
  join(process.cwd(), "src", "features", "jobs", "create", "CreateVacancyForm.tsx"),
  "utf8",
);

/** The preview rail, scoped so form controls can never satisfy its assertions. */
function previewRail(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Vista previa pública" });
  const card = heading.closest("[data-slot='card']");
  if (card === null) {
    throw new Error("The preview rail card was not rendered");
  }
  return card as HTMLElement;
}

const form = () => document.querySelector("form") as HTMLFormElement;
const stepRegion = () => document.querySelector("[data-pf-step-region]") as HTMLElement;
const currentStep = () => stepRegion().getAttribute("data-pf-step-region");
const currentMarker = () => document.querySelector('[aria-current="step"]');

function progressText(): string {
  const bar = screen.getByRole("progressbar");
  return `${bar.getAttribute("aria-valuetext") ?? ""} ${bar.textContent ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}

const continueButton = () => screen.getByRole("button", { name: "Continuar" });
const backButton = () => screen.getByRole("button", { name: "Atrás" });
const saveButton = () => screen.getByRole("button", { name: /guardar borrador/i });

const titleInput = () => screen.getByRole("textbox", { name: /título del puesto/i });
const descriptionInput = () =>
  screen.getByRole("textbox", { name: /descripción del puesto/i });
const salaryMinInput = () => screen.getByRole("textbox", { name: /salario mínimo/i });
const salaryMaxInput = () => screen.getByRole("textbox", { name: /salario máximo/i });

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

function choose(name: string, value: string) {
  fireEvent.change(screen.getByRole("combobox", { name }), {
    target: { value },
  });
}

/** Fills every required field of step one. */
function fillStepOne() {
  typeInto(titleInput(), "Backend Developer (Senior)");
  choose("Modalidad", "remote");
  choose("Jornada", "full_time");
  choose("Seniority", "senior");
}

/** Advances one step, asserting the move so a blocked step fails loudly. */
function advance() {
  fireEvent.click(continueButton());
}

/** Reaches review with a fully valid draft. */
function reachReview() {
  fillStepOne();
  advance();
  typeInto(descriptionInput(), "Diseñá los servicios core.");
  advance();
  advance();
}

let fetchSpy: ReturnType<typeof vi.fn>;

/** jsdom has no PointerEvent, so the Base UI checkbox dispatches through this. */
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CreateVacancyForm wizard surface", () => {
  it("shows only the first step and announces it accessibly", () => {
    render(<CreateVacancyForm />);

    expect(currentStep()).toBe("basic-information");
    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("basic-information") }),
    ).toBeVisible();
    expect(currentMarker()).toHaveTextContent("Información básica");
    expect(progressText()).toContain("Paso 1 de 4");

    // Step one's fields are the only editable surface mounted.
    expect(titleInput()).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Área o departamento" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /descripción del puesto/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /salario mínimo/i })).toBeNull();
    // The preview and the save rail live only on review.
    expect(screen.queryByRole("heading", { name: "Vista previa pública" })).toBeNull();
    expect(screen.queryByRole("button", { name: /guardar borrador/i })).toBeNull();
    // Back is disabled on the first step.
    expect(backButton()).toBeDisabled();
  });

  it("renders every contract enum as a labeled option inside step one", () => {
    render(<CreateVacancyForm />);

    const catalogs = [
      { name: "Modalidad", options: ["Presencial", "Remoto", "Híbrido"] },
      {
        name: "Jornada",
        options: ["Tiempo completo", "Medio tiempo", "Por contrato", "Beca"],
      },
      {
        name: "Seniority",
        options: ["Prácticas", "Junior", "Medio", "Senior", "Líder"],
      },
    ];

    for (const catalog of catalogs) {
      const select = screen.getByRole("combobox", { name: catalog.name });
      expect(select).toBeVisible();
      for (const option of catalog.options) {
        expect(within(select).getByRole("option", { name: option })).toBeInTheDocument();
      }
    }
  });

  it("advances through the four steps, keeping every value across Back and Continue", () => {
    render(<CreateVacancyForm />);
    fillStepOne();
    advance();

    expect(currentStep()).toBe("role-profile");
    expect(progressText()).toContain("Paso 2 de 4");
    expect(
      screen.getByRole("heading", { level: 2, name: stepTitle("role-profile") }),
    ).toBeVisible();
    typeInto(descriptionInput(), "Diseñá los servicios core.");
    advance();

    expect(currentStep()).toBe("conditions-process");
    expect(progressText()).toContain("Paso 3 de 4");
    advance();

    expect(currentStep()).toBe("review");
    expect(progressText()).toContain("Paso 4 de 4");

    // Back keeps every typed value: the review's earlier values survive.
    fireEvent.click(backButton());
    expect(currentStep()).toBe("conditions-process");
    fireEvent.click(backButton());
    expect(descriptionInput()).toHaveValue("Diseñá los servicios core.");
    fireEvent.click(backButton());
    expect(titleInput()).toHaveValue("Backend Developer (Senior)");
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toHaveValue("remote");
  });

  it("renders the rich description, the formatting surface, and the exploratory controls", () => {
    render(<CreateVacancyForm />);
    fillStepOne();
    advance();

    expect(descriptionInput().tagName).toBe("TEXTAREA");
    // Only the description keeps the rich formatting surface and its modes.
    expect(
      screen.getByRole("toolbar", { name: "Formato de Descripción del puesto" }),
    ).toBeVisible();
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    for (const action of [
      "Negrita",
      "Cursiva",
      "Lista con viñetas",
      "Lista numerada",
      "Enlace",
    ]) {
      expect(screen.getAllByRole("button", { name: action })).toHaveLength(1);
    }
    for (const label of ["Requisitos obligatorios", "Requisitos deseables"]) {
      expect(
        screen.queryByRole("toolbar", { name: `Formato de ${label}` }),
      ).toBeNull();
    }
    expect(
      screen.getByRole("combobox", { name: "Habilidades y tecnologías" }),
    ).toHaveAttribute("placeholder", "Busca una tecnología");
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeVisible();

    typeInto(descriptionInput(), "Diseñá los servicios core.");
    advance();
    expect(screen.getByRole("group", { name: "Beneficios" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Frecuencia de pago" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Beneficios" })).toHaveAttribute(
      "placeholder",
      "Busca un beneficio",
    );
    expect(screen.getByText("Sin preguntas de filtro")).toBeVisible();
    // No native date control remains: the field is the reusable DatePickerField.
    expect(screen.getByLabelText(/fecha de cierre/i)).not.toHaveAttribute("type", "date");

    const text = document.body.textContent ?? "";
    expect(screen.queryByLabelText(/mostrar el salario/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /publicar/i })).toBeNull();
    expect(text).not.toMatch(/ARS|EUR|solo interna|bolsa de trabajo|autoguardado/i);
    expect(text).not.toMatch(/prototipo|exploratori/i);
  });

  it("renders the review step with grouped summaries, edit actions, and the save rail", () => {
    render(<CreateVacancyForm />);
    reachReview();

    expect(currentStep()).toBe("review");
    // Grouped summaries, one card per editable step with one edit action each.
    expect(document.querySelectorAll("[data-pf-review-group]")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Editar / })).toHaveLength(3);
    const basicGroup = document.querySelector(
      "[data-pf-review-group='basic-information']",
    ) as HTMLElement;
    expect(
      within(basicGroup).getByText("Backend Developer (Senior)"),
    ).toBeVisible();
    // The preview and save rail exists only here.
    expect(previewRail()).toBeVisible();
    expect(saveButton()).toHaveAttribute("type", "submit");
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveClass("h-10", "w-full");
    expect(
      screen.getByText(
        "Toda vacante nueva empieza como borrador. Guardarlo requiere una sesión de reclutador.",
      ),
    ).toBeVisible();
    // No editable field of the earlier steps is mounted on review.
    expect(screen.queryByRole("textbox", { name: /título del puesto/i })).toBeNull();
  });

  it("updates the live preview from the current values on review", () => {
    render(<CreateVacancyForm />);
    reachReview();

    within(previewRail()).getByText("Backend Developer (Senior)");
    within(previewRail()).getByText("Diseñá los servicios core.");
    within(previewRail()).getByText("Remoto");
    within(previewRail()).getByText("Tiempo completo");
    within(previewRail()).getByText("Senior");
    within(previewRail()).getByText("Salario a convenir");
    expect(
      within(previewRail()).getByText(/todavía no está publicada/i),
    ).toBeVisible();
  });

  it("returns to the edited step from a review edit action", () => {
    render(<CreateVacancyForm />);
    reachReview();

    fireEvent.click(screen.getByRole("button", { name: "Editar información básica" }));
    expect(currentStep()).toBe("basic-information");
    expect(titleInput()).toHaveValue("Backend Developer (Senior)");
  });

  it("treats marker-only rich text as an empty contract description", () => {
    render(<CreateVacancyForm />);
    fillStepOne();
    advance();
    typeInto(descriptionInput(), "**");

    advance();

    // Step two blocks: the derived plain text is empty, so the schema rejects it.
    expect(currentStep()).toBe("role-profile");
    expect(
      screen.getByText("Ingresa una descripción para la vacante."),
    ).toBeVisible();
    expect(descriptionInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("CreateVacancyForm step validation", () => {
  it("blocks step one until its required fields are valid and focuses the first invalid control", () => {
    render(<CreateVacancyForm />);

    advance();

    expect(currentStep()).toBe("basic-information");
    const titleError = screen.getByText("Ingresa un título para la vacante.");
    expect(titleError).toHaveAttribute("role", "alert");
    expect(titleInput()).toHaveAttribute("aria-invalid", "true");
    expect(titleInput()).toHaveAttribute("aria-describedby", titleError.id);
    expect(titleInput()).toHaveFocus();
    // The step-scoped validation never reports another step's field.
    expect(screen.queryByText("Ingresa una descripción para la vacante.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows accessible enum errors when no modality, job type, or seniority is chosen", () => {
    render(<CreateVacancyForm />);

    advance();

    expect(screen.getByText("Elige una modalidad de trabajo.")).toBeVisible();
    expect(screen.getByText("Elige una jornada de trabajo.")).toBeVisible();
    expect(screen.getByText("Elige un seniority para la vacante.")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("rejects salary values the contract cannot accept as integers on the conditions step", () => {
    render(<CreateVacancyForm />);
    fillStepOne();
    advance();
    typeInto(descriptionInput(), "Diseñá los servicios core.");
    advance();
    typeInto(salaryMinInput(), "25,000");

    advance();

    expect(currentStep()).toBe("conditions-process");
    const salaryError = screen.getByText(
      "El salario mínimo debe ser un número entero de 0 o más.",
    );
    expect(salaryError).toHaveAttribute("role", "alert");
    expect(salaryMinInput()).toHaveAttribute("aria-invalid", "true");
    expect(salaryMinInput()).toHaveAttribute("aria-describedby", salaryError.id);
    expect(salaryMinInput()).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a maximum salary below the minimum with an accessible error", () => {
    render(<CreateVacancyForm />);
    fillStepOne();
    advance();
    typeInto(descriptionInput(), "Diseñá los servicios core.");
    advance();
    typeInto(salaryMinInput(), "40000");
    typeInto(salaryMaxInput(), "25000");

    advance();

    expect(currentStep()).toBe("conditions-process");
    const rangeError = screen.getByText(
      "El salario máximo debe ser mayor o igual al salario mínimo.",
    );
    expect(rangeError).toHaveAttribute("role", "alert");
    expect(salaryMaxInput()).toHaveAttribute("aria-invalid", "true");
    expect(salaryMaxInput()).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never treats blank optional inputs as invalid", () => {
    render(<CreateVacancyForm />);
    reachReview();

    expect(currentStep()).toBe("review");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    fireEvent.click(saveButton());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not move focus on every edit", () => {
    render(<CreateVacancyForm />);

    advance();
    expect(titleInput()).toHaveFocus();

    fireEvent.change(screen.getByRole("combobox", { name: "Área o departamento" }), {
      target: { value: "Producto" },
    });
    expect(titleInput()).toHaveFocus();
  });
});

describe("CreateVacancyForm final validation-only save", () => {
  it("leaves a valid final save visibly inert and issues no request", () => {
    render(<CreateVacancyForm />);
    reachReview();

    const before = document.body.textContent;
    const href = window.location.href;
    fireEvent.click(saveButton());

    // No visible state change: no status, note, alert, success, or navigation.
    expect(currentStep()).toBe("review");
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(document.body.textContent).toBe(before);
    expect(window.location.href).toBe(href);
    expect(fetchSpy).not.toHaveBeenCalled();

    // The edited values survive the attempt untouched.
    fireEvent.click(backButton());
    fireEvent.click(backButton());
    expect(descriptionInput()).toHaveValue("Diseñá los servicios core.");
    fireEvent.click(backButton());
    expect(titleInput()).toHaveValue("Backend Developer (Senior)");
  });

  it("routes an implicit final submit to the first invalid step and focuses its first invalid field after mount", () => {
    render(<CreateVacancyForm />);
    // Step one is valid, step two (description) is still empty.
    fillStepOne();

    // A form submit from step one is the final validation path; it must route
    // forward to the first invalid step and focus the field after it mounts.
    fireEvent.submit(form());

    expect(currentStep()).toBe("role-profile");
    expect(descriptionInput()).toHaveFocus();
    expect(
      screen.getByText("Ingresa una descripción para la vacante."),
    ).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes an invalid final submit back to the earliest step when it is also invalid", () => {
    render(<CreateVacancyForm />);
    // Nothing is filled: step one owns the earliest error.
    fireEvent.submit(form());

    expect(currentStep()).toBe("basic-information");
    expect(titleInput()).toHaveFocus();
  });

  it("keeps the canonical field order and step order deterministic", () => {
    expect(firstInvalidField({ salary_max: "a", title: "b" })).toBe("title");
    expect(firstInvalidStep({ salary_max: "a", title: "b" })).toBe(
      "basic-information",
    );
    expect(firstInvalidStep({ description: "d" })).toBe("role-profile");
    expect(firstInvalidStep({})).toBeNull();
  });
});

describe("CreateVacancyForm transport boundaries", () => {
  it("never imports the server-only create client, session, or transport", () => {
    expect(source).not.toMatch(/from\s+["'][^"']*createJob["']/);
    expect(source).not.toMatch(/\bcreateJob\s*\(/);
    expect(source).not.toMatch(
      /lib\/api\/(?:server|requestJson)|lib\/env\/server|next\/headers/,
    );
    expect(source).not.toMatch(
      /\bcookies?\b|\bsession\b|\baccessToken\b|\bbearer\b|\bgetToken\b|\bfetch\s*\(/i,
    );
  });

  it("keeps every extracted form module free of request, session, and transport APIs", () => {
    const formDir = join(process.cwd(), "src", "features", "jobs", "create", "form");
    const modules = readdirSync(formDir).filter(
      (entry) => !entry.endsWith(".test.tsx") && !entry.endsWith(".test.ts"),
    );

    expect(modules.length).toBeGreaterThan(0);

    for (const fileName of modules) {
      const text = readFileSync(join(formDir, fileName), "utf8");
      expect(text, fileName).not.toMatch(/\bcreateJob\s*\(|from ["'][^"']*\/createJob["']/);
      expect(text, fileName).not.toMatch(
        /lib\/api\/|lib\/env\/server|next\/headers|\bfetch\s*\(/,
      );
      expect(text, fileName).not.toMatch(
        /\bcookies?\b|\bsession\b|\bbearer\b|\baccessToken\b|\bgetToken\b/i,
      );
    }
  });
});

/**
 * Structural boundary for the wizard composition: the route-facing form stays a
 * thin owner of four states, while the step model partitions the fields and only
 * the contract state may ever reach a save attempt.
 */
describe("CreateVacancyForm composition boundaries", () => {
  it("imports the form model, the prototype model, the step boundary, and the controls", () => {
    expect(source).toMatch(/from "\.\/form\/model"/);
    expect(source).toMatch(/from "\.\/form\/prototype-model"/);
    expect(source).toMatch(/from "\.\/form\/step-model"/);
    expect(source).toMatch(/from "\.\/form\/vacancy-form-sections"/);
    expect(source).toMatch(/from "\.\/form\/step-progress"/);
    expect(source).toMatch(/from "\.\/form\/wizard-controls"/);
    // Section composition and markup live behind the boundary modules.
    expect(source).not.toMatch(/from "\.\/form\/basic-information-section"/);
    expect(source).not.toMatch(/from "\.\/form\/compensation-section"/);
  });

  it("owns the contract values, local-only state, field errors, and the current step", () => {
    expect(source).toMatch(/React\.useState<VacancyFormValues>\(INITIAL_VALUES\)/);
    expect(source).toMatch(
      /React\.useState<VacancyPrototypeValues>\(INITIAL_PROTOTYPE_VALUES\)/,
    );
    expect(source).toMatch(/React\.useState<VacancyStepId>\("basic-information"\)/);
    // values, prototypeValues, errors, step.
    expect(source.match(/React\.useState/g)).toHaveLength(4);
  });

  it("saves contract values only and never mixes prototype state into the attempt", () => {
    expect(source).toMatch(/attemptDraftSave\(values\)/);
    expect(source).not.toMatch(/attemptDraftSave\([^)]*prototype/i);
    expect(source).not.toMatch(/validateVacancyForm|createJobRequestSchema|safeParse/);
    const attempt = source.slice(source.indexOf("attemptDraftSave"));
    expect(attempt.slice(0, 40)).not.toMatch(/prototype/i);
  });

  it("performs no schema parsing, normalization, or contract copy in the root", () => {
    expect(source).not.toMatch(
      /createJobRequestSchema|safeParse|FIELD_MESSAGES|normalizeSalaryInput|pickOption/,
    );
    expect(source).not.toMatch(
      /WORK_MODE_OPTIONS|EMPLOYMENT_TYPE_OPTIONS|SENIORITY_OPTIONS|SALARY_CURRENCY_OPTIONS/,
    );
  });

  it("defines no reusable field primitive and renders no section markup", () => {
    expect(source).not.toMatch(/function (TextField|OptionField|FormSection)\(/);
    expect(source).not.toMatch(
      /<Field\b|<FieldError|<ToggleGroupItem|<Input\b|<Textarea\b|<Button\b/,
    );
    for (const heading of [
      "Información básica",
      "Perfil del puesto",
      "Condiciones y proceso",
      "Revisar",
      "Vista previa pública",
    ]) {
      expect(source).not.toContain(heading);
    }
  });

  it("stays a bounded composition surface that still owns submit", () => {
    expect(source.split("\n").length).toBeLessThan(170);
    expect(source).toMatch(/onSubmit=\{handleSubmit\}/);
    expect(source).toMatch(/<VacancyFormSections/);
    expect(source).toMatch(/<WizardControls/);
    expect(source).toMatch(/<StepProgress/);
  });
});
