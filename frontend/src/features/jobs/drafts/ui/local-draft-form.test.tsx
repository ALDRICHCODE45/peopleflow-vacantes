import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Captures the complete model handed to the accepted serializer without adding
// any production-only prop or visible test payload.
const hoisted = vi.hoisted(() => ({ serialized: [] as unknown[] }));

vi.mock("../requesters/actions", () => ({
  searchRequestersAction: vi.fn(async () => ({ ok: true, items: [{ id: "123e4567-e89b-42d3-a456-426614174001", kind: "client", name: "Cliente del catálogo" }], nextCursor: null })),
  createRequesterAction: vi.fn(),
}));
vi.mock("@/components/ui/combobox", async (original) => ({
  ...await original<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({children}: {children: React.ReactNode}) => <>{children}</>,
  // Popup-only live region would be unmounted in the closed real portal.
  ComboboxEmpty: () => null,
}));

vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn(async () => ({ok:true,draftId:"saved",etag:'"v1"',version:"1",savedAt:"2026-10-06T03:00:00Z"})) }));
vi.mock("sileo", () => ({sileo:{success:vi.fn(() => "local-draft-success"),error:vi.fn(() => "local-draft-error"),dismiss:vi.fn()}}));

vi.mock("@/features/jobs/drafts/model", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/jobs/drafts/model")>();
  return {
    ...actual,
    draftModelToPostBody: (model: unknown) => {
      const result = actual.draftModelToPostBody(model as never);
      hoisted.serialized.push(model);
      return result;
    },
  };
});

/**
 * Base UI's portaled select popup depends on browser positioning that jsdom
 * cannot complete, so this adapter preserves the component's real controlled
 * `value` / `items` / `onValueChange` contract as a native select.
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

import { createDraftModel, hydrateDraftModel, type DraftModel } from "@/features/jobs/drafts/model";
import { draftPostBodySchema } from "@/features/jobs/drafts/fields";

import { LocalDraftForm } from "./local-draft-form";


const ID = "123e4567-e89b-42d3-a456-426614174000";
const TS = "2026-10-06T03:00:00.123456Z";

const TITLE_ERROR = "El título supera los 200 caracteres permitidos.";
const LOCATION_ERROR = "La ubicación supera los 300 caracteres permitidos.";
const SUCCESS = "Borrador local válido. Recuerda que no se guarda en el servidor.";
const NOTICE =
  "Este borrador es solo local. Si sales o recargas la página, perderás los cambios.";
const LIST_ITEM_EMPTY = "Escribe un valor o quita la fila.";
const COMPENSATION_AMOUNT_ERROR =
  "Usa solo números con hasta 2 decimales, sin espacios (por ejemplo, 30000.50).";

const richDescription = {
  schema_version: 1,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Buscamos ", marks: [{ type: "bold" }] },
          { type: "text", text: "talento" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }],
          },
        ],
      },
    ],
  },
};

/** Realistic fully populated 17-field model, hydrated through the read schema. */
function populatedInitialModel(): DraftModel {
  return hydrateDraftModel({
    schema_version: 1,
    id: ID,
    status: "draft",
    principal_recruiter_id: ID,
    version: "1",
    created_at: TS,
    updated_at: TS,
    fields: {
      title: "Backend Go",
      location: "Ciudad de México",
      work_mode: "hybrid",
      work_schedule: "full_time",
      contract_type: "indefinite",
      seniority: "senior",
      professional_area: "technology_systems",
      required_requirements: "Go y PostgreSQL",
      preferred_requirements: "Kubernetes",
      skills: Array.from({ length: 25 }, (_, index) => `Habilidad ${index + 1}`),
      custom_benefits: ["Café gratis", "Estacionamiento", "Guardería"],
      benefits: [
        "health_insurance",
        "computer_equipment",
        "flexible_schedule",
        "annual_bonus",
        "wellness",
      ],
      screening_questions: Array.from({ length: 7 }, (_, index) => ({
        prompt: `Pregunta ${index + 1}`,
      })),
      requester: { kind: "client", id: ID, name: "Cliente Ejemplo" },
      languages: [
        { language: "es", custom_name: null, level: "native" },
        { language: "en", custom_name: null, level: "advanced" },
        { language: "other", custom_name: "Francés", level: "basic" },
        { language: "other", custom_name: null, level: null },
        { language: "en", custom_name: null, level: null },
        { language: "other", custom_name: "Alemán", level: "intermediate" },
      ],
      compensation: {
        mode: "range",
        amount: null,
        min: "30000",
        max: "45000",
        currency: "MXN",
        pay_period: "monthly",
        basis: "gross",
        public_visible: false,
      },
      description: richDescription,
      description_plain: "Buscamos talento\nGo",
    },
  });
}

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const SOURCE = readFileSync(
  join(process.cwd(), "src/features/jobs/drafts/ui/local-draft-form.tsx"),
  "utf8",
);

const titleInput = () => screen.getByRole("textbox", { name: "Título" });
const locationInput = () => screen.getByRole("textbox", { name: "Ubicación" });
const modeSelect = () => screen.getByRole("combobox", { name: "Modalidad" });
const validateButton = () =>
  screen.getByRole("button", { name: /^(Validar borrador|Guardar borrador|Guardar cambios)$/ });
const continueButton = () => screen.getByRole("button", { name: "Continuar" });
const backButton = () => screen.getByRole("button", { name: "Atrás" });
const successStatus = () => screen.queryByRole("status");
/** Number of the step currently exposed, read from the progress indicator. */
function currentStep(): number {
  const item = document.querySelector(
    "[data-pf-draft-progress] [aria-current='step']",
  );
  const value = item?.getAttribute("data-step");
  if (!value) throw new Error("No exposed wizard step");
  return Number(value);
}
/** Explicit step navigation; hidden controls are never queried by role. */
function goToStep(target: number) {
  while (currentStep() < target) fireEvent.click(continueButton());
  while (currentStep() > target) fireEvent.click(backButton());
}
/** The explicit final boundary: step 5, then Validar borrador. */
function validateDraft() {
  goToStep(5);
  fireEvent.click(validateButton());
}
const captured = (index: number) => hoisted.serialized[index] as DraftModel;
/** The accepted write schema normalizes the captured raw candidate. */
const normalizedFields = (index: number) =>
  draftPostBodySchema.parse({ fields: captured(index).fields }).fields;

function toggleCheckbox(name: string) {
  const control = screen.getByRole("checkbox", { name });
  const native = control.parentElement?.querySelector("input[type='checkbox']");
  expect(native, `${name} native input`).not.toBeNull();
  fireEvent.click(native as HTMLElement);
}

beforeEach(() => {
  hoisted.serialized.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LocalDraftForm presentation", () => {
  it("renders one local-only warning, grouped sections and the explicit validate control for v1", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note")).toHaveTextContent(NOTICE);

    // Five progressive steps; only the active one is exposed at a time.
    const steps = [
      {
        heading: "Paso 1 de 5: Información básica",
        sections: ["Detalles de la vacante", "Solicitante"],
      },
      {
        heading: "Paso 2 de 5: Descripción y perfil",
        sections: ["Requisitos", "Habilidades", "Idiomas", "Descripción"],
      },
      {
        heading: "Paso 3 de 5: Compensación y beneficios",
        sections: ["Compensación", "Prestaciones"],
      },
      {
        heading: "Paso 4 de 5: Preguntas",
        sections: ["Preguntas de filtro"],
      },
      {
        heading: "Paso 5 de 5: Revisión final",
        sections: [],
      },
    ];
    for (let step = 1; step <= steps.length; step += 1) {
      goToStep(step);
      expect(screen.getByRole("heading", { name: steps[step - 1].heading })).toBeVisible();
      for (const heading of steps[step - 1].sections) {
        expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      }
    }

    expect(validateButton()).toBeEnabled();

    // No save affordance. The determinate step progress is real navigation
    // feedback, not loading theater.
    expect(screen.queryByRole("button", { name: /guardar/i })).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Paso 5 de 5",
    );
  });

  it("presents one primary card with one footer and the numbered progress for every step", () => {
    render(<LocalDraftForm />);

    // Application-reference composition: a single numbered progress bar and no
    // legacy nested section cards anywhere in the surface.
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(document.querySelectorAll("[data-slot='progress']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-pf-section-card]")).toHaveLength(0);

    // Each hidden, still-mounted step panel owns exactly one primary card, and
    // that card owns exactly one consistent footer.
    const panels = document.querySelectorAll("[data-pf-draft-step]");
    expect(panels).toHaveLength(5);
    for (const panel of panels) {
      expect(panel.querySelectorAll("[data-pf-draft-card]")).toHaveLength(1);
      expect(panel.querySelectorAll("[data-slot='card-footer']")).toHaveLength(1);
    }
  });

  it("declares no transport, storage, navigation or session concern in source", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "useRouter",
      "cookies",
      "Authorization",
      "Bearer",
      "lib/api",
    ]) {
      expect(SOURCE, `local-draft-form.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("performs no network or storage access when validating v1", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");

    render(<LocalDraftForm initialModel={createDraftModel()} />);
    fireEvent.change(titleInput(), { target: { value: "Backend" } });
    validateDraft();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});

describe("LocalDraftForm five-step wizard", () => {
  it("exposes only the active step and hides the other controls from assistive tech", () => {
    render(<LocalDraftForm />);

    expect(document.querySelectorAll("[data-pf-draft-step]")).toHaveLength(5);
    expect(document.querySelectorAll("[data-pf-draft-step]:not([hidden])")).toHaveLength(1);
    expect(titleInput()).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Paso 2 de 5: Descripción y perfil" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar habilidad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Validar borrador" })).toBeNull();
  });

  it("shows current step semantics in the progress indicator", () => {
    render(<LocalDraftForm />);

    expect(screen.getByRole("list", { name: "Pasos del borrador" })).toBeVisible();
    expect(currentStep()).toBe(1);
    goToStep(2);
    expect(currentStep()).toBe(2);
  });

  it("navigates back and forward retaining every raw typed value", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "Backend Go" } });
    goToStep(2);
    fireEvent.click(screen.getByRole("button", { name: "Agregar habilidad" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Habilidad 1" }), {
      target: { value: "Go" },
    });
    goToStep(3);
    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "fixed" },
    });
    goToStep(4);
    expect(backButton()).toBeEnabled();

    goToStep(1);
    expect(titleInput()).toHaveValue("Backend Go");
    expect(backButton()).toBeDisabled();
    goToStep(2);
    expect(screen.getByRole("textbox", { name: "Habilidad 1" })).toHaveValue("Go");
    goToStep(3);
    expect(
      screen.getByRole("combobox", { name: "Modo de compensación" }),
    ).toHaveValue("fixed");
  });

  it("does not validate or claim success when Enter submits before the last step", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "Backend" } });
    const form = titleInput().closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(hoisted.serialized).toHaveLength(0);
    expect(successStatus()).toBeNull();
    expect(currentStep()).toBe(2);
  });

  it("keeps the step navigation buttons out of the submit path", () => {
    render(<LocalDraftForm />);

    expect(continueButton()).toHaveAttribute("type", "button");
    goToStep(2);
    expect(backButton()).toHaveAttribute("type", "button");
  });

  it("routes the first invalid field back to its step and focuses the step heading", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);
    fireEvent.click(validateButton());

    expect(currentStep()).toBe(1);
    expect(screen.getByText(TITLE_ERROR)).toBeVisible();
    expect(hoisted.serialized).toHaveLength(0);
    const heading = screen.getByRole("heading", {
      name: "Paso 1 de 5: Información básica",
    });
    expect(document.activeElement).toBe(heading);
  });

  it("routes an indexed screening error to the questions step with reachable feedback", () => {
    // Explicit v1 fixture: this test preserves the legacy v1 `DraftListField`
    // screening path and its "no serializer call on invalid input" invariant.
    // A fresh wizard (no props) is local v2 and is covered separately below.
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);
    fireEvent.click(validateButton());

    expect(currentStep()).toBe(4);
    const input = screen.getByRole("textbox", { name: "Pregunta 1" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      document.activeElement,
    ).toBe(screen.getByRole("heading", { name: "Paso 4 de 5: Preguntas" }));
    expect(hoisted.serialized).toHaveLength(0);
  });

  it("summarizes the captured data truthfully without saved or completed claims", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);
    goToStep(5);

    const reviewHeading = screen.getByRole("heading", {
      name: "Paso 5 de 5: Revisión final",
    });
    expect(reviewHeading).toBeVisible();
    const reviewCard = reviewHeading.closest("[data-pf-draft-card]") as HTMLElement;
    expect(within(reviewCard).getByText("Backend Go")).toBeVisible();
    expect(within(reviewCard).getByText("Cliente Ejemplo")).toBeVisible();
    expect(screen.queryByText(/guardado|completado|enviado/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /guardar/i })).toBeNull();
  });

  it("validates an incomplete draft without demanding fields the schema does not require", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(5);
    fireEvent.click(validateButton());

    expect(successStatus()).toHaveTextContent(SUCCESS);
    expect(hoisted.serialized).toHaveLength(1);
  });
});

describe("LocalDraftForm basic group (previous 3-field rules)", () => {
  it("keeps typed spacing verbatim while typing and after blur", () => {
    render(<LocalDraftForm />);

    const rawTitle = "  Título   con  espacios  ";
    fireEvent.change(titleInput(), { target: { value: rawTitle } });
    expect(titleInput()).toHaveValue(rawTitle);
    fireEvent.blur(titleInput());
    expect(titleInput()).toHaveValue(rawTitle);

    fireEvent.change(locationInput(), { target: { value: "  CDMX  " } });
    expect(locationInput()).toHaveValue("  CDMX  ");
    fireEvent.blur(locationInput());
    expect(locationInput()).toHaveValue("  CDMX  ");
  });

  it("starts the raw controls from the provided initial model", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);

    expect(titleInput()).toHaveValue("Backend Go");
    expect(locationInput()).toHaveValue("Ciudad de México");
    expect(modeSelect()).toHaveValue("hybrid");
    expect(screen.getByRole("combobox", { name: "Jornada" })).toHaveValue("full_time");
    expect(screen.getByRole("combobox", { name: "Tipo de contrato" })).toHaveValue(
      "indefinite",
    );
    expect(screen.getByRole("combobox", { name: "Nivel" })).toHaveValue("senior");
    expect(screen.getByRole("combobox", { name: "Área profesional" })).toHaveValue(
      "technology_systems",
    );
  });

  it("validates an untouched empty draft as a valid null-valued snapshot", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    validateDraft();

    expect(successStatus()).toHaveTextContent(SUCCESS);
    expect(hoisted.serialized).toHaveLength(1);
    const model = captured(0);
    expect(normalizedFields(0).title).toBeNull();
    expect(normalizedFields(0).work_mode).toBeNull();
    expect(model.fields.requester).toBeNull();
  });

  it("accepts a 200-codepoint title and rejects 201 without touching the raw input", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    fireEvent.change(titleInput(), { target: { value: "a".repeat(200) } });
    validateDraft();
    expect(successStatus()).toHaveTextContent(SUCCESS);

    goToStep(1);
    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    validateDraft();
    expect(currentStep()).toBe(1);
    expect(successStatus()).toBeNull();
    expect(screen.getByText(TITLE_ERROR)).toBeVisible();
    expect(titleInput()).toHaveValue("a".repeat(201));
    expect(titleInput()).not.toBeDisabled();
    expect(hoisted.serialized).toHaveLength(1);
  });

  it("reports every invalid control in one atomic pass and never serializes", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    fireEvent.change(locationInput(), { target: { value: "b".repeat(301) } });
    validateDraft();

    expect(screen.getByText(TITLE_ERROR)).toBeVisible();
    expect(screen.getByText(LOCATION_ERROR)).toBeVisible();
    expect(successStatus()).toBeNull();
    expect(hoisted.serialized).toHaveLength(0);
  });

  it("wires aria-invalid and aria-describedby to the visible error", () => {
    render(<LocalDraftForm />);

    expect(titleInput()).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    validateDraft();

    const input = titleInput();
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)).toHaveTextContent(TITLE_ERROR);
  });

  it("clears the edited control's error while the other error waits for revalidation", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    fireEvent.change(locationInput(), { target: { value: "b".repeat(301) } });
    validateDraft();
    expect(screen.getByText(TITLE_ERROR)).toBeVisible();
    expect(screen.getByText(LOCATION_ERROR)).toBeVisible();

    fireEvent.change(titleInput(), { target: { value: "Backend" } });
    expect(screen.queryByText(TITLE_ERROR)).toBeNull();
    expect(screen.getByText(LOCATION_ERROR)).toBeVisible();
  });

  it("invalidates previous success and keeps the raw input editable after an edit", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    fireEvent.change(titleInput(), { target: { value: "Backend" } });
    validateDraft();
    expect(successStatus()).toBeVisible();

    goToStep(1);
    fireEvent.change(titleInput(), { target: { value: "Backend Go" } });
    expect(successStatus()).toBeNull();
    expect(titleInput()).toHaveValue("Backend Go");
  });

  it("normalizes only at the explicit boundary and leaves the raw inputs untouched", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    fireEvent.change(titleInput(), { target: { value: "  Backend Go  " } });
    fireEvent.change(locationInput(), { target: { value: "  CDMX  " } });
    validateDraft();

    expect(normalizedFields(0).title).toBe("Backend Go");
    expect(normalizedFields(0).location).toBe("CDMX");
    goToStep(1);
    expect(titleInput()).toHaveValue("  Backend Go  ");
    expect(locationInput()).toHaveValue("  CDMX  ");
  });

  it("submits through the form so the button and Enter share one boundary", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    goToStep(5);
    const form = validateButton().closest("form");
    expect(form).not.toBeNull();
    expect(validateButton()).toHaveAttribute("type", "submit");

    fireEvent.submit(form!);
    expect(hoisted.serialized).toHaveLength(1);
    expect(successStatus()).toHaveTextContent(SUCCESS);
  });
});

describe("LocalDraftForm no-op losslessness", () => {
  it("preserves all 17 fields, derived text and rich JSON through the serializer boundary", () => {
    const initial = populatedInitialModel();

    render(<LocalDraftForm initialModel={initial} />);
    expect(hoisted.serialized).toHaveLength(0);

    validateDraft();

    expect(successStatus()).toHaveTextContent(SUCCESS);
    expect(hoisted.serialized).toHaveLength(1);
    const model = captured(0);
    expect(normalizedFields(0)).toEqual(initial.fields);
    expect(model.requesterName).toBe("Cliente Ejemplo");
    expect(model.descriptionPlain).toBe("Buscamos talento\nGo");
    expect(model.fields.description).toBe(initial.fields.description);
    // Exact money strings survive with no float conversion.
    expect(normalizedFields(0).compensation).toEqual({
      mode: "range",
      amount: null,
      min: "30000.00",
      max: "45000.00",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: false,
    });
    // The supplied requester and name are untouched without an explicit change.
    expect(model.fields.requester).toEqual({ kind: "client", id: ID });
    expect(initial.fields.title).toBe("Backend Go");
    expect(normalizedFields(0).skills).toHaveLength(25);
  });
});

describe("LocalDraftForm lists beyond the legacy caps", () => {
  it("preserves 25 skills, 6 languages and 7 screening questions", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);

    validateDraft();

    const fields = captured(0).fields;
    expect(normalizedFields(0).skills).toHaveLength(25);
    expect(normalizedFields(0).languages).toHaveLength(6);
    expect(normalizedFields(0).screening_questions).toHaveLength(7);
    expect(fields.custom_benefits).toEqual(["Café gratis", "Estacionamiento", "Guardería"]);
    expect(fields.benefits).toEqual([
      "health_insurance",
      "computer_equipment",
      "flexible_schedule",
      "annual_bonus",
      "wellness",
    ]);
  });

  it("allows a 100-item list and disables the add control at the contract bound", () => {
    const initial = populatedInitialModel();
    initial.fields.skills = Array.from({ length: 100 }, (_, index) => `Habilidad ${index + 1}`);

    render(<LocalDraftForm initialModel={initial} />);

    goToStep(2);
    expect(screen.getByRole("button", { name: "Agregar habilidad" })).toBeDisabled();
    validateDraft();
    expect(normalizedFields(0).skills).toHaveLength(100);
  });

  it("adds, edits and removes an accessible repeatable row", () => {
    render(<LocalDraftForm />);
    goToStep(2);

    fireEvent.click(screen.getByRole("button", { name: "Agregar habilidad" }));
    const row = screen.getByRole("textbox", { name: "Habilidad 1" });
    fireEvent.change(row, { target: { value: "React" } });
    expect(row).toHaveValue("React");

    fireEvent.click(screen.getByRole("button", { name: "Quitar habilidad 1" }));
    expect(screen.queryByRole("textbox", { name: "Habilidad 1" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agregar habilidad" }));
    validateDraft();
    expect(currentStep()).toBe(2);
    expect(screen.getByText(LIST_ITEM_EMPTY)).toBeVisible();
    expect(hoisted.serialized).toHaveLength(0);
  });
});

describe("LocalDraftForm screening question errors", () => {
  it.each(["", "x".repeat(2001)])("associates an invalid prompt with its visible error (%#)", (prompt) => {
    // Explicit v1 fixture, same reason as the routing test above.
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    const input = screen.getByRole("textbox", { name: "Pregunta 1" });
    fireEvent.change(input, { target: { value: prompt } });
    validateDraft();

    expect(input).toHaveValue(prompt);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errorId = input.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toBeVisible();
    expect(document.getElementById(errorId!)).not.toHaveTextContent(/^$/);
    expect(hoisted.serialized).toHaveLength(0);
  });
});

describe("LocalDraftForm compensation", () => {
  it("keeps exact money strings and composes only the active mode", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(3);

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Monto" }), {
      target: { value: "999999999999.99" },
    });
    validateDraft();

    expect(normalizedFields(0).compensation).toEqual({
      mode: "fixed",
      amount: "999999999999.99",
      min: null,
      max: null,
      currency: "MXN",
      pay_period: "monthly",
      basis: null,
      public_visible: false,
    });

    goToStep(3);
    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "range" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Mínimo" }), {
      target: { value: "30000" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Máximo" }), {
      target: { value: "45000" },
    });
    validateDraft();

    const range = normalizedFields(1).compensation;
    expect(range).toEqual({
      mode: "range",
      amount: null,
      min: "30000.00",
      max: "45000.00",
      currency: "MXN",
      pay_period: "monthly",
      basis: null,
      public_visible: false,
    });
  });

  it("keeps an inactive amount buffer across mode changes", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(3);

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Monto" }), {
      target: { value: "12000" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "range" },
    });
    expect(screen.queryByRole("textbox", { name: "Monto" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "fixed" },
    });
    expect(screen.getByRole("textbox", { name: "Monto" })).toHaveValue("12000");

    validateDraft();
    expect(normalizedFields(0).compensation.amount).toBe("12000.00");
  });

  it("rejects malformed money without serializing or claiming success", () => {
    render(<LocalDraftForm />);
    goToStep(3);

    fireEvent.change(screen.getByRole("combobox", { name: "Modo de compensación" }), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Monto" }), {
      target: { value: "1,5" },
    });
    validateDraft();

    expect(currentStep()).toBe(3);
    expect(screen.getByText(COMPENSATION_AMOUNT_ERROR)).toBeVisible();
    expect(successStatus()).toBeNull();
    expect(hoisted.serialized).toHaveLength(0);
  });

  it("toggles the honest public visibility checkbox", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(3);

    toggleCheckbox("Mostrar la compensación cuando se publique la vacante");
    validateDraft();

    expect(normalizedFields(0).compensation.public_visible).toBe(true);
  });
});

describe("LocalDraftForm languages without CEFR mapping", () => {
  it("sends custom_name only for other and keeps the levels exact", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(2);

    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Idioma 1" }), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del idioma 1" }), {
      target: { value: "Francés" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Nivel del idioma 1" }), {
      target: { value: "advanced" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Idioma 2" }), {
      target: { value: "en" },
    });

    validateDraft();

    expect(normalizedFields(0).languages).toEqual([
      { language: "other", custom_name: "Francés", level: "advanced" },
      { language: "en", custom_name: null, level: null },
    ]);
    expect(SOURCE).not.toMatch(/CEFR|[ABC][12]\b/);
  });

  it("keeps a custom-name buffer when the row language changes", () => {
    render(<LocalDraftForm />);
    goToStep(2);

    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Idioma 1" }), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del idioma 1" }), {
      target: { value: "Alemán" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Idioma 1" }), {
      target: { value: "en" },
    });
    expect(screen.queryByRole("textbox", { name: "Nombre del idioma 1" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Idioma 1" }), {
      target: { value: "other" },
    });
    expect(screen.getByRole("textbox", { name: "Nombre del idioma 1" })).toHaveValue(
      "Alemán",
    );
  });

  it("rejects a row without a language", () => {
    render(<LocalDraftForm />);
    goToStep(2);

    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
    validateDraft();

    expect(currentStep()).toBe(2);
    expect(screen.getByText("Elige un idioma.")).toBeVisible();
    expect(hoisted.serialized).toHaveLength(0);
  });
});

describe("LocalDraftForm requester", () => {
  it("composes a selected catalog entry as kind/id and keeps the name for preview", async () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);
    fireEvent.change(screen.getByRole("combobox", {name:"Área o cliente"}), {target:{value:"Cliente"}});
    fireEvent.click(await screen.findByRole("option", {name:"Cliente del catálogo"}));
    validateDraft();
    expect(captured(0).fields.requester).toEqual({kind:"client",id:"123e4567-e89b-42d3-a456-426614174001"});
    expect(captured(0).requesterName).toBe("Cliente del catálogo");
  });
  it("preserves the supplied requester and name on a no-op", () => {
    const initial = populatedInitialModel();
    render(<LocalDraftForm initialModel={initial} />);

    expect(screen.getByRole("combobox", { name: "Tipo de solicitante" })).toHaveValue(
      "client",
    );
    const nameSelector = screen.getByRole("combobox", { name: "Área o cliente" });
    expect(nameSelector).not.toBeDisabled();
    expect(nameSelector).toHaveAttribute("placeholder", "Cliente Ejemplo");

    validateDraft();

    expect(captured(0).fields.requester).toEqual({ kind: "client", id: ID });
    expect(captured(0).requesterName).toBe("Cliente Ejemplo");  });

  it("clears a mismatched id and name with a visible indication when the type changes", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de solicitante" }), {
      target: { value: "internal_area" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Cliente Ejemplo");
    expect(screen.getByRole("combobox", { name: "Área o cliente" })).not.toBeDisabled();

    validateDraft();

    expect(captured(0).fields.requester).toEqual({ kind: "internal_area", id: null });
  });

  it("keeps a null requester for an empty draft and records an explicit selection", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);

    validateDraft();
    expect(captured(0).fields.requester).toBeNull();

    goToStep(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de solicitante" }), {
      target: { value: "client" },
    });
    validateDraft();
    expect(captured(1).fields.requester).toEqual({ kind: "client", id: null });
  });

  it("offers no manual identifier control", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);

    expect(screen.queryByRole("textbox", { name: /identificador|uuid|id del/i })).toBeNull();
  });
});

describe("LocalDraftForm description", () => {
  it("edits the rich description and sends it through the serializer", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);
    goToStep(2);

    const editable = screen.getByLabelText("Descripción de la vacante");
    fireEvent.paste(editable, {
      clipboardData: { getData: () => " extra", types: ["text/plain"] },
    });

    validateDraft();

    const description = captured(0).fields.description;
    expect(description).not.toBeNull();
    expect(JSON.stringify(description)).toContain("extra");
  });
});

describe("LocalDraftForm preview integration", () => {
  const publicRegion = () =>
    document.querySelector("[data-pf-draft-public]") as HTMLElement;
  const internalRegion = () =>
    document.querySelector("[data-pf-draft-internal]") as HTMLElement;

  it("shows the updated raw content in the public preview after a back edit", () => {
    render(<LocalDraftForm />);

    fireEvent.change(titleInput(), { target: { value: "Backend Go" } });
    goToStep(5);
    expect(within(publicRegion()).getByText("Backend Go")).toBeVisible();

    goToStep(1);
    fireEvent.change(titleInput(), { target: { value: "Backend Rust" } });
    goToStep(5);

    expect(within(publicRegion()).getByText("Backend Rust")).toBeVisible();
    expect(within(publicRegion()).queryByText("Backend Go")).toBeNull();
  });

  it("keeps the requester out of the public preview while showing it internally", () => {
    render(<LocalDraftForm initialModel={populatedInitialModel()} />);
    goToStep(5);

    expect(within(publicRegion()).queryByText("Cliente Ejemplo")).toBeNull();
    expect(within(internalRegion()).getByText("Cliente Ejemplo")).toBeVisible();
  });
});

describe("LocalDraftForm fresh local v2 screening", () => {
  const candidatePreview = () =>
    document.querySelector("[data-pf-draft-questionnaire-preview]");
  const candidateNotice = () =>
    document.querySelector("[data-pf-candidate-questionnaire-notice]");

  it("starts a fresh wizard on the v2 editor with the three explicit types", () => {
    render(<LocalDraftForm />);
    goToStep(4);

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    const type = screen.getByRole("combobox", { name: "Tipo de pregunta 1" });
    expect(type).toHaveValue("open");
    const typeValues = within(type)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(typeValues).toContain("single_choice_informative");
    expect(typeValues).toContain("single_choice_evaluated");

    // An open question has no options editor; switching type reveals it.
    expect(screen.queryByRole("textbox", { name: "Opción 1.1" })).toBeNull();
    fireEvent.change(type, { target: { value: "single_choice_informative" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }),
    );
    expect(screen.getByRole("textbox", { name: "Opción 1.1" })).toBeVisible();
  });

  it("keeps an explicit initialModel on the legacy v1 path with no type editor", () => {
    render(<LocalDraftForm initialModel={createDraftModel()} />);
    goToStep(4);

    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "Tipo de pregunta 1" }),
    ).toBeNull();
  });

  it("saves a complete v2 question without leaking it into the v1 body", async () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Qué modalidad prefieres?" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de pregunta 1" }), {
      target: { value: "single_choice_informative" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Agregar opción a la pregunta 1" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Opción 1.1" }), {
      target: { value: "Remoto" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Opción 1.2" }), {
      target: { value: "Híbrido" },
    });

    validateDraft();

    await waitFor(() => expect(successStatus()).toHaveTextContent("Guardado · versión 1"));
    expect(hoisted.serialized).toHaveLength(1);
    // The internal placeholder honored by the v1 serializer is empty: the v2
    // questions never cross into the v1 write body.
    expect(captured(0).fields.screening_questions).toEqual([]);
  });

  it("opens the candidate simulation in a dialog that stays outside the wizard form", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    goToStep(5);

    // Nothing simulates the candidate until the explicit request.
    expect(candidatePreview()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Probar cuestionario" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Probar cuestionario" }),
    ).toBeVisible();
    const preview = candidatePreview();
    expect(preview).not.toBeNull();
    expect(dialog.contains(preview as Node)).toBe(true);

    const wizardForm = document.querySelector("[data-pf-local-draft-form] form");
    expect(wizardForm).not.toBeNull();
    // The preview's own native form is never nested inside the wizard form.
    expect(wizardForm?.contains(preview as Node)).toBe(false);
    const innerForm = (preview as HTMLElement).querySelector("form");
    expect(innerForm).not.toBeNull();
    expect(wizardForm?.contains(innerForm as Node)).toBe(false);
  });

  it("never validates the draft when the preview simulation is submitted", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    goToStep(5);
    fireEvent.click(screen.getByRole("button", { name: "Probar cuestionario" }));

    const innerForm = candidatePreview()?.querySelector("form");
    expect(innerForm).not.toBeNull();
    fireEvent.submit(innerForm as HTMLFormElement);

    expect(hoisted.serialized).toHaveLength(0);
    expect(successStatus()).toBeNull();
  });

  it("closes the simulation dialog with Escape and returns focus to its trigger", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    goToStep(5);
    const openButton = screen.getByRole("button", { name: "Probar cuestionario" });
    // jsdom's fireEvent.click does not move focus, so mirror the browser and
    // focus the opener before it records the focus-restore target.
    openButton.focus();
    fireEvent.click(openButton);
    expect(screen.getByRole("dialog")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });

  it("disables the simulation and explains itself while the v2 questions are invalid", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);

    const openButton = screen.getByRole("button", { name: "Probar cuestionario" });
    expect(openButton).toBeDisabled();
    expect(candidateNotice()).toBeVisible();

    goToStep(4);
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    goToStep(5);
    expect(screen.getByRole("button", { name: "Probar cuestionario" })).toBeEnabled();
    expect(candidateNotice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Probar cuestionario" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "Simular cuestionario",
      }),
    ).toBeVisible();
  });

  it("retains the raw question when navigating back from the review step", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pregunta 1" }), {
      target: { value: "¿Cuál es tu experiencia?" },
    });
    goToStep(5);
    goToStep(4);

    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toHaveValue(
      "¿Cuál es tu experiencia?",
    );
    // The questions panel is still the open one when returning.
    expect(screen.getByRole("button", { name: /^Pregunta 1\b/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens the first invalid question when validation rejects the draft", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);
    fireEvent.click(validateButton());

    expect(currentStep()).toBe(4);
    const trigger = screen.getByRole("button", { name: /^Pregunta 1\b/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // The 16 other fields are valid, so the internal v1 serializer runs once as
    // the source of truth, but no success snapshot is ever committed.
    expect(successStatus()).toBeNull();
  });

  it("reopens the invalid question on a repeated validation attempt", () => {
    render(<LocalDraftForm />);
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);
    fireEvent.click(validateButton());

    expect(currentStep()).toBe(4);
    const trigger = () => screen.getByRole("button", { name: /^Pregunta 1\b/ });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");

    // A manual collapse must not survive a fresh explicit validation request.
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    goToStep(5);
    fireEvent.click(validateButton());
    expect(currentStep()).toBe(4);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("combines other-field and v2 errors atomically without serializing", () => {
    render(<LocalDraftForm />);
    fireEvent.change(titleInput(), { target: { value: "a".repeat(201) } });
    goToStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Agregar pregunta" }));
    goToStep(5);
    fireEvent.click(validateButton());

    // Earliest step wins, and nothing is serialized on a rejected pass.
    expect(currentStep()).toBe(1);
    expect(screen.getByText(TITLE_ERROR)).toBeVisible();
    expect(hoisted.serialized).toHaveLength(0);

    // The screening error is preserved, its question opens and stays reachable.
    goToStep(4);
    expect(screen.getByRole("textbox", { name: "Pregunta 1" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Pregunta 1\b/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("LocalDraftForm ambiguous screening seeds", () => {
  const AMBIGUOUS = "Cannot combine v1 screening questions with a v2 screening seed.";

  it("rejects an explicit v2 seed combined with a non-empty v1 screening list", () => {
    const initial = populatedInitialModel();
    expect(initial.fields.screening_questions.length).toBeGreaterThan(0);

    expect(() =>
      render(<LocalDraftForm initialModel={initial} initialScreeningQuestionsV2={[]} />),
    ).toThrow(AMBIGUOUS);
  });

  it("rejects the combination even with a non-empty v2 seed", () => {
    const initial = populatedInitialModel();

    expect(() =>
      render(
        <LocalDraftForm
          initialModel={initial}
          initialScreeningQuestionsV2={[
            { id: ID, type: "open", prompt: "¿Pregunta v2?" },
          ]}
        />,
      ),
    ).toThrow(AMBIGUOUS);
  });

  it("reuses the 16 fields when the v1 screening list is empty plus a v2 seed", async () => {
    const initial = populatedInitialModel();
    initial.fields.screening_questions = [];

    render(
      <LocalDraftForm
        initialModel={initial}
        initialScreeningQuestionsV2={[
          { id: ID, type: "open", prompt: "¿Pregunta v2?" },
        ]}
      />,
    );

    validateDraft();

    await waitFor(() => expect(successStatus()).toHaveTextContent("Guardado · versión 1"));
    expect(hoisted.serialized).toHaveLength(1);
    // The empty v1 screening list is the only accepted combination; the other
    // 16 normalized fields survive untouched and the v2 questions stay out of
    // the v1 placeholder body.
    expect(normalizedFields(0)).toEqual({ ...initial.fields, screening_questions: [] });
  });
});
