import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CreateVacancyForm } from "./CreateVacancyForm";
import { firstInvalidField } from "./form/model";

const AUTH_NOTICE = /iniciar sesión como reclutador/i;

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

/** The completion card of the rail, scoped so section copy cannot satisfy it. */
function completionCard(): HTMLElement {
  const card = document.querySelector("[data-pf-completion-summary]");
  if (card === null) {
    throw new Error("The completion card was not rendered");
  }
  return card as HTMLElement;
}

/** Document order check: does `second` render after `first`? */
const follows = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const titleInput = () =>
  screen.getByRole("textbox", { name: /título del puesto/i });
const descriptionInput = () =>
  screen.getByRole("textbox", { name: /descripción del puesto/i });
const locationInput = () =>
  screen.getByRole("textbox", { name: /ubicación/i });
const salaryMinInput = () =>
  screen.getByRole("textbox", { name: /salario mínimo/i });
const salaryMaxInput = () =>
  screen.getByRole("textbox", { name: /salario máximo/i });
const saveButton = () =>
  screen.getByRole("button", { name: /guardar borrador/i });

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

type RequiredFieldLabels = {
  workMode?: string;
  employmentType?: string;
  seniority?: string;
};

/** Fills every required contract field, choosing options by their Spanish label. */
function fillRequiredFields(labels: RequiredFieldLabels = {}) {
  typeInto(titleInput(), "Backend Developer (Senior)");
  typeInto(descriptionInput(), "Diseñá los servicios core.");
  fireEvent.click(
    screen.getByRole("button", { name: labels.workMode ?? "Remoto" }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: labels.employmentType ?? "Tiempo completo",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: labels.seniority ?? "Senior" }),
  );
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

describe("CreateVacancyForm contract surface", () => {
  it("renders every contract and exploratory section plus the draft rail", () => {
    render(<CreateVacancyForm />);

    for (const heading of [
      "Información básica",
      "Compensación",
      "Descripción y requisitos",
      "Estrategia de contratación",
      "Beneficios y frecuencia de pago",
      "Preguntas de filtro",
      "Vista previa pública",
      "Guardar borrador",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    // The superseded plain-text description card left the active tree.
    expect(screen.queryByRole("heading", { name: "Descripción" })).toBeNull();
  });

  it("renders every POST /jobs field with an accessible Spanish label", () => {
    render(<CreateVacancyForm />);

    expect(titleInput()).toBeVisible();
    expect(descriptionInput()).toBeVisible();
    expect(descriptionInput().tagName).toBe("TEXTAREA");
    expect(locationInput()).toBeVisible();
    expect(salaryMinInput()).toBeVisible();
    expect(salaryMaxInput()).toBeVisible();
  });

  it("renders every contract enum value as a labeled option", () => {
    render(<CreateVacancyForm />);

    for (const option of [
      "Presencial",
      "Remoto",
      "Híbrido",
      "Tiempo completo",
      "Medio tiempo",
      "Por contrato",
      "Beca",
      "Prácticas",
      "Junior",
      "Medio",
      "Senior",
      "Líder",
      "MXN",
      "USD",
    ]) {
      expect(screen.getByRole("button", { name: option })).toBeVisible();
    }

    expect(screen.getByRole("group", { name: "Modalidad" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Jornada" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Seniority" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Moneda" })).toBeVisible();
  });

  it("exposes every requested enriched surface and still invents nothing", () => {
    const { container } = render(<CreateVacancyForm />);

    // The contract description now lives inside the requirements composition.
    expect(descriptionInput()).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Descripción y requisitos" }),
    ).toBeVisible();

    expect(
      screen.getByRole("combobox", { name: "Área o departamento" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Habilidades y tecnologías" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeVisible();
    // The closing date is the reusable DatePickerField, not a native date input.
    expect(screen.getByLabelText(/fecha de cierre/i)).not.toHaveAttribute("type", "date");
    expect(screen.getByRole("group", { name: "Beneficios" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Frecuencia de pago" })).toBeVisible();
    expect(screen.getByText("Sin preguntas de filtro")).toBeVisible();

    const text = container.textContent ?? "";
    // Unsupported currencies, private visibility, and publishing stay absent.
    expect(screen.queryByLabelText(/mostrar el salario/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /publicar/i })).toBeNull();
    expect(text).not.toMatch(/ARS|EUR|solo interna|bolsa de trabajo|autoguardado/i);
    // The exploratory fields say what they are.
    expect(text).toMatch(/vista exploratoria y todavía no se guardan/i);
    expect(text).toMatch(/formato visual de prototipo/i);
  });

  it("treats marker-only rich text as an empty contract description", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();
    typeInto(descriptionInput(), "**");

    fireEvent.click(saveButton());

    // The contract stores derived plain text, so formatting markers alone are
    // not a description.
    expect(
      screen.getByText("Ingresá una descripción para la vacante."),
    ).toBeVisible();
    expect(descriptionInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(AUTH_NOTICE)).toBeNull();
  });

  it("keeps the exploratory limits inherited and sends nothing while exploring", () => {
    render(<CreateVacancyForm />);

    expect(screen.queryAllByRole("textbox", { name: /^Pregunta /u })).toHaveLength(0);

    const addQuestion = screen.getByRole("button", { name: "Agregar pregunta" });
    fireEvent.click(addQuestion);
    fireEvent.click(addQuestion);
    fireEvent.click(addQuestion);
    fireEvent.click(addQuestion);

    // The shared prototype ceiling stops the fourth question.
    expect(screen.getAllByRole("textbox", { name: /^Pregunta /u })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Agregar pregunta" })).toBeDisabled();
    expect(screen.queryByText("Sin preguntas de filtro")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the formatting surface, the chips, and the frequency options available", () => {
    render(<CreateVacancyForm />);

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
      screen.getByRole("combobox", { name: "Habilidades y tecnologías" }),
    ).toHaveAttribute("placeholder", "Buscá una tecnología");
    expect(document.querySelector('[data-slot="combobox-chip"]')).toBeNull();

    for (const frequency of ["Mensual", "Anual", "Por hora"]) {
      expect(screen.getByRole("button", { name: frequency })).toBeVisible();
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
  });

  it("discloses the exploratory rail copy beside the unchanged save action", () => {
    render(<CreateVacancyForm />);

    expect(
      screen.getByText(
        "Los campos avanzados son una vista exploratoria y todavía no se guardan.",
      ),
    ).toBeVisible();
    expect(saveButton()).toHaveAttribute("type", "submit");
    expect(saveButton()).toBeEnabled();
  });

  it("shows accessible required errors for title and description", () => {
    render(<CreateVacancyForm />);

    fireEvent.click(saveButton());

    const titleError = screen.getByText("Ingresá un título para la vacante.");
    const descriptionError = screen.getByText(
      "Ingresá una descripción para la vacante.",
    );

    expect(titleError).toHaveAttribute("role", "alert");
    expect(descriptionError).toHaveAttribute("role", "alert");
    expect(titleInput()).toHaveAttribute("aria-invalid", "true");
    expect(descriptionInput()).toHaveAttribute("aria-invalid", "true");
    expect(titleInput()).toHaveAttribute("aria-describedby", titleError.id);
    expect(descriptionInput()).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-disclosure vacancy-description-error",
    );
    // Validation wins: nothing claims a save was possible.
    expect(screen.queryByText(AUTH_NOTICE)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows accessible enum errors when no modality, job type, or seniority is chosen", () => {
    render(<CreateVacancyForm />);

    fireEvent.click(saveButton());

    expect(
      screen.getByText("Elegí una modalidad de trabajo."),
    ).toBeVisible();
    expect(screen.getByText("Elegí una jornada de trabajo.")).toBeVisible();
    expect(
      screen.getByText("Elegí un seniority para la vacante."),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Modalidad" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("rejects salary values the contract cannot accept as integers", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();
    typeInto(salaryMinInput(), "25,000");

    fireEvent.click(saveButton());

    const salaryError = screen.getByText(
      "El salario mínimo debe ser un número entero de 0 o más.",
    );
    expect(salaryError).toHaveAttribute("role", "alert");
    expect(salaryMinInput()).toHaveAttribute("aria-invalid", "true");
    expect(salaryMinInput()).toHaveAttribute(
      "aria-describedby",
      salaryError.id,
    );
    expect(screen.queryByText(AUTH_NOTICE)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a maximum salary below the minimum with an accessible error", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();
    typeInto(salaryMinInput(), "40000");
    typeInto(salaryMaxInput(), "25000");

    fireEvent.click(saveButton());

    const rangeError = screen.getByText(
      "El salario máximo debe ser mayor o igual al salario mínimo.",
    );
    expect(rangeError).toHaveAttribute("role", "alert");
    expect(salaryMaxInput()).toHaveAttribute("aria-invalid", "true");
    expect(salaryMaxInput()).toHaveAttribute(
      "aria-describedby",
      rangeError.id,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never treats blank optional inputs as invalid", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();

    fireEvent.click(saveButton());

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(locationInput()).toHaveAttribute("aria-invalid", "false");
    expect(salaryMinInput()).toHaveAttribute("aria-invalid", "false");
    expect(salaryMaxInput()).toHaveAttribute("aria-invalid", "false");
    // The empty optionals are dropped, so the draft attempt is a valid one.
    expect(screen.getByRole("status")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("updates the live preview from the current form values", () => {
    render(<CreateVacancyForm />);

    within(previewRail()).getByText("Título del puesto");
    within(previewRail()).getByText("Salario a convenir");

    fillRequiredFields({ seniority: "Líder" });
    typeInto(locationInput(), "Monterrey, NL");
    typeInto(salaryMinInput(), "25000");
    typeInto(salaryMaxInput(), "40000");

    expect(
      within(previewRail()).getByText("Backend Developer (Senior)"),
    ).toBeVisible();
    expect(
      within(previewRail()).getByText("Tu empresa · Monterrey, NL"),
    ).toBeVisible();
    expect(
      within(previewRail()).getByText(
        "Diseñá los servicios core.",
      ),
    ).toBeVisible();
    expect(within(previewRail()).getByText("Remoto")).toBeVisible();
    expect(within(previewRail()).getByText("Tiempo completo")).toBeVisible();
    expect(within(previewRail()).getByText("Líder")).toBeVisible();
    expect(
      within(previewRail()).getByText("MXN 25,000 – MXN 40,000"),
    ).toBeVisible();
    // The preview stays a draft, before and after editing.
    expect(
      within(previewRail()).getByText(/todavía no está publicada/i),
    ).toBeVisible();
  });
});

describe("CreateVacancyForm truthful save boundary", () => {
  it("explains the missing recruiter session on a valid attempt and issues no request", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();

    fireEvent.click(saveButton());

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(AUTH_NOTICE);
    expect(notice).toHaveTextContent(/no se envió ninguna solicitud/i);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the save control usable and the notice persistent", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();

    fireEvent.click(saveButton());
    expect(saveButton()).toBeEnabled();
    expect(screen.getByRole("status")).toBeVisible();

    // Further editing does not silently drop the honest blocked state.
    typeInto(titleInput(), "Backend Developer (Staff)");
    expect(screen.getByRole("status")).toBeVisible();

    fireEvent.click(saveButton());
    expect(screen.getByRole("status")).toHaveTextContent(AUTH_NOTICE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replaces the notice with field errors when a later attempt is invalid", () => {
    render(<CreateVacancyForm />);
    fillRequiredFields();
    fireEvent.click(saveButton());
    expect(screen.getByRole("status")).toBeVisible();

    typeInto(titleInput(), "   ");
    fireEvent.click(saveButton());

    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByText("Ingresá un título para la vacante."),
    ).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

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
    const formDir = join(
      process.cwd(),
      "src",
      "features",
      "jobs",
      "create",
      "form",
    );
    const modules = readdirSync(formDir).filter(
      (entry) => !entry.endsWith(".test.tsx"),
    );

    // The folder must actually exist and carry the extracted responsibilities.
    expect(modules.length).toBeGreaterThan(0);

    for (const fileName of modules) {
      const text = readFileSync(join(formDir, fileName), "utf8");
      expect(text).not.toMatch(/\bcreateJob\s*\(|from ["'][^"']*\/createJob["']/);
      expect(text).not.toMatch(
        /lib\/api\/|lib\/env\/server|next\/headers|\bfetch\s*\(/,
      );
      expect(text).not.toMatch(
        /\bcookies?\b|\bsession\b|\bbearer\b|\baccessToken\b|\bgetToken\b/i,
      );
    }
  });
});

describe("CreateVacancyForm invalid-submit focus", () => {
  it("orders the invalid fields by the canonical contract order", () => {
    expect(firstInvalidField({ salary_max: "a", title: "b" })).toBe("title");
    expect(
      firstInvalidField({ salary_currency: "c", work_mode: "d" }),
    ).toBe("work_mode");
    expect(firstInvalidField({})).toBeNull();
  });

  it("focuses the first invalid field on an invalid submit", () => {
    render(<CreateVacancyForm />);

    fireEvent.click(saveButton());
    expect(titleInput()).toHaveFocus();

    typeInto(titleInput(), "Backend Developer");
    typeInto(descriptionInput(), "Diseñá los servicios core.");
    fireEvent.click(saveButton());

    // The composite Modalidad control has no text input, so the first real
    // toggle button inside it receives focus.
    expect(screen.getByRole("button", { name: "Presencial" })).toHaveFocus();
    expect(salaryMinInput()).not.toHaveFocus();
  });

  it("does not move focus on every edit and leaves a valid attempt alone", () => {
    render(<CreateVacancyForm />);

    fireEvent.click(saveButton());
    descriptionInput().focus();
    typeInto(titleInput(), "Backend Developer");
    expect(descriptionInput()).toHaveFocus();

    fillRequiredFields();
    descriptionInput().focus();
    fireEvent.click(saveButton());
    expect(descriptionInput()).toHaveFocus();
    expect(screen.getByRole("status")).toBeVisible();
  });

  it("derives the contract description from the local-only rich value", () => {
    expect(source).toMatch(/toPlainText/);
  });
});

describe("CreateVacancyForm completion rail", () => {
  it("reports observable content between the preview and the save card", () => {
    render(<CreateVacancyForm />);

    const card = completionCard();
    const save = saveButton().closest("[data-slot='card']");
    if (save === null) throw new Error("The save card was not rendered");

    // Rail order stays preview, progress, save.
    expect(
      screen
        .getByRole("complementary", { name: "Vista previa y guardado" })
        .querySelectorAll("[data-pf-completion-summary]"),
    ).toHaveLength(1);
    expect(follows(previewRail(), card)).toBe(true);
    expect(follows(card, save)).toBe(true);

    expect(
      within(card).getByRole("heading", { name: "Progreso de la vacante" }),
    ).toBeVisible();
    expect(
      within(card).getByText(
        "Seguimiento de las secciones con contenido. No valida el formulario ni confirma que se guardó.",
      ),
    ).toBeVisible();
    expect(within(card).getByText("0 de 6 secciones completas")).toBeVisible();
  });

  it("updates the count from the live values without claiming a save", () => {
    render(<CreateVacancyForm />);
    const card = completionCard();

    // A title alone is not basic information yet: the three enums are missing.
    typeInto(titleInput(), "Backend Developer");
    expect(within(card).getByText("0 de 6 secciones completas")).toBeVisible();

    fillRequiredFields();
    expect(within(card).getByText("2 de 6 secciones completas")).toBeVisible();
    expect(within(card).getAllByText("Completa")).toHaveLength(2);
    expect(within(card).getAllByText("Pendiente")).toHaveLength(4);

    typeInto(salaryMinInput(), "25000");
    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro de salud" }));
    const bar = within(card).getByRole("progressbar", {
      name: "Secciones de la vacante con contenido",
    });
    expect(within(card).getByText("4 de 6 secciones completas")).toBeVisible();
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuetext", "4 de 6 secciones completas");

    // Progress stays observational: no request, no save or autosave claim, and
    // it never absorbs the auth-blocked outcome of the save card.
    const text = card.textContent ?? "";
    expect(text).toMatch(/ni confirma que se guardó/i);
    expect(text).not.toMatch(
      /autoguardado|guardado automáticamente|borrador guardado|listo para guardar/i,
    );
    expect(text).not.toMatch(/iniciar sesión como reclutador/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    expect(screen.getByRole("status")).toHaveTextContent(AUTH_NOTICE);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(within(card).getByText("4 de 6 secciones completas")).toBeVisible();
  });
});

/**
 * Structural boundary for the enriched composition: the route-facing form stays a
 * thin owner of two states, while the section boundary owns the section tree and
 * only the contract state may ever reach a save attempt.
 */
describe("CreateVacancyForm composition boundaries", () => {
  it("imports the form model, the prototype model, the section boundary, and the rail", () => {
    expect(source).toMatch(/from "\.\/form\/model"/);
    expect(source).toMatch(/from "\.\/form\/prototype-model"/);
    expect(source).toMatch(/from "\.\/form\/vacancy-form-sections"/);
    expect(source).toMatch(/from "\.\/form\/draft-rail"/);
    // Section composition and markup live behind the boundary module.
    expect(source).not.toMatch(/from "\.\/form\/basic-information-section"/);
    expect(source).not.toMatch(/from "\.\/form\/description-section"/);
    expect(source).not.toMatch(/from "\.\/form\/compensation-section"/);
  });

  it("owns exactly two pieces of state: contract values and local-only prototype", () => {
    expect(source).toMatch(
      /React\.useState<VacancyFormValues>\(INITIAL_VALUES\)/,
    );
    expect(source).toMatch(
      /React\.useState<VacancyPrototypeValues>\(INITIAL_PROTOTYPE_VALUES\)/,
    );
    // values, prototypeValues, errors, notice.
    expect(source.match(/React\.useState/g)).toHaveLength(4);
  });

  it("saves contract values only and never mixes prototype state into the attempt", () => {
    expect(source).toMatch(/attemptDraftSave\(values\)/);
    expect(source).not.toMatch(/attemptDraftSave\([^)]*prototype/i);
    expect(source).not.toMatch(/validateVacancyForm|createJobRequestSchema|safeParse/);
    // The save call itself names no prototype identifier.
    const attempt = source.slice(source.indexOf("attemptDraftSave"));
    expect(attempt.slice(0, 40)).not.toMatch(/prototype/i);
  });

  it("performs no schema parsing, normalization, or contract copy in the root", () => {
    expect(source).not.toMatch(
      /createJobRequestSchema|safeParse|FIELD_MESSAGES|normalizeSalaryInput|pickOption/,
    );
    expect(source).not.toMatch(
      /AUTH_REQUIRED_NOTICE|WORK_MODE_OPTIONS|EMPLOYMENT_TYPE_OPTIONS|SENIORITY_OPTIONS|SALARY_CURRENCY_OPTIONS/,
    );
  });

  it("defines no reusable field primitive and renders no section markup", () => {
    expect(source).not.toMatch(/function (TextField|OptionField|FormSection)\(/);
    expect(source).not.toMatch(
      /<Field\b|<FieldError|<ToggleGroupItem|<Input\b|<Textarea\b|<Button\b/,
    );
    for (const heading of [
      "Información básica",
      "Descripción y requisitos",
      "Compensación",
      "Estrategia de contratación",
      "Beneficios y frecuencia de pago",
      "Preguntas de filtro",
      "Vista previa pública",
    ]) {
      expect(source).not.toContain(heading);
    }
  });

  it("stays a bounded composition surface that still owns submit", () => {
    expect(source.split("\n").length).toBeLessThan(160);
    expect(source).toMatch(/onSubmit=\{handleSubmit\}/);
    expect(source).toMatch(/<VacancyFormSections/);
    expect(source).toMatch(/<DraftRail/);
  });
});
