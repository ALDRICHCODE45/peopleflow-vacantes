import { readFileSync } from "node:fs";
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

import { StrategySection, capSelectedSkills, pickCefr } from "./strategy-section";
import { sectionAnchorId, sectionTitle } from "./section-metadata";
import {
  CEFR_LEVEL_OPTIONS,
  DEPARTMENTS,
  INITIAL_PROTOTYPE_VALUES,
  MAX_LANGUAGES,
  MAX_SKILLS,
  SKILLS,
} from "./prototype-model";
import type { LanguageRequirement, VacancyPrototypeValues } from "./prototype-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "strategy-section.tsx"), "utf8");

const english: LanguageRequirement = {
  id: "language-1",
  language: "Inglés",
  level: "B2",
};
const portuguese: LanguageRequirement = {
  id: "language-2",
  language: "Portugués",
  level: "A2",
};
const french: LanguageRequirement = {
  id: "language-3",
  language: "Francés",
  level: "B1",
};

// jsdom implements neither matchMedia, ResizeObserver, nor PointerEvent, and the
// documented combobox and select primitives read all three while they interact.
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

beforeEach(() => {
  stubBrowserApis();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSection(overrides: Partial<VacancyPrototypeValues> = {}) {
  const values: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides,
  };
  const onChange = vi.fn();

  render(<StrategySection values={values} onChange={onChange} />);

  return { values, onChange };
}

/** The first value object handed to onChange. */
function firstPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls[0][0] as VacancyPrototypeValues;
}

/** Renders one department selection and returns the RTL handle for unmount. */
function renderSectionWithDepartment(department: string) {
  return render(
    <StrategySection
      values={{ ...INITIAL_PROTOTYPE_VALUES, department }}
      onChange={vi.fn()}
    />,
  );
}

function chipsContainer(): HTMLElement {
  const container = document.querySelector('[data-slot="combobox-chips"]');
  if (container === null) {
    throw new Error("The skills chips container was not rendered");
  }
  return container as HTMLElement;
}

describe("StrategySection fields", () => {
  it("renders the strategy card with its documented selection controls", () => {
    renderSection();

    expect(
      screen.getByRole("heading", { name: "Estrategia de contratación" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Área o departamento" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Habilidades y tecnologías" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeVisible();
    expect(screen.getByLabelText(/fecha de cierre/iu)).toHaveAttribute(
      "type",
      "date",
    );
  });

  it("reports a closing date change without mutating the caller values", () => {
    const { values, onChange } = renderSection();

    fireEvent.change(screen.getByLabelText(/fecha de cierre/iu), {
      target: { value: "2026-12-31" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).closingDate).toBe("2026-12-31");
    expect(firstPayload(onChange)).not.toBe(values);
    expect(values.closingDate).toBe("");
  });
});

describe("StrategySection technologies", () => {
  it("renders one removable chip per selected technology with exact names", () => {
    const { onChange } = renderSection({ skills: ["React", "TypeScript"] });
    const container = chipsContainer();

    expect(within(container).getByText("React")).toBeVisible();
    expect(
      within(container).getByRole("button", { name: "Quitar React" }),
    ).toBeVisible();
    expect(
      within(container).getByRole("button", { name: "Quitar TypeScript" }),
    ).toBeVisible();
    expect(container.querySelectorAll('[data-slot="combobox-chip"]')).toHaveLength(
      2,
    );

    fireEvent.click(
      within(container).getByRole("button", { name: "Quitar React" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).skills).toEqual(["TypeScript"]);
  });

  it("shows how many technologies are selected out of the limit", () => {
    renderSection({ skills: ["React", "TypeScript"] });

    expect(
      screen.getByText(`2 de ${MAX_SKILLS} tecnologías seleccionadas.`),
    ).toBeVisible();
  });

  it("caps the technology selection at the prototype maximum", () => {
    expect(SKILLS.length).toBeGreaterThan(MAX_SKILLS);

    const capped = capSelectedSkills([...SKILLS]);

    expect(capped).toHaveLength(MAX_SKILLS);
    expect(capped).toEqual(SKILLS.slice(0, MAX_SKILLS));
    // A selection inside the limit is returned untouched.
    expect(capSelectedSkills(["React"])).toEqual(["React"]);
  });
});

describe("StrategySection languages", () => {
  it("labels every language row in Spanish and removes the right one", () => {
    const { values, onChange } = renderSection({ languages: [english, portuguese] });

    expect(screen.getByLabelText("Idioma 1")).toHaveValue("Inglés");
    expect(screen.getByRole("combobox", { name: "Nivel 1" })).toBeVisible();
    expect(screen.getByLabelText("Idioma 2")).toHaveValue("Portugués");
    expect(screen.getByRole("combobox", { name: "Nivel 2" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 1" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).languages).toEqual([portuguese]);
    expect(values.languages).toEqual([english, portuguese]);
  });

  it("updates one language through the immutable helper and keeps other fields", () => {
    const { values, onChange } = renderSection({
      department: "Ingeniería",
      languages: [english, portuguese],
    });

    fireEvent.change(screen.getByLabelText("Idioma 1"), {
      target: { value: "Alemán" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = firstPayload(onChange);
    expect(next.languages).toEqual([
      { id: "language-1", language: "Alemán", level: "B2" },
      portuguese,
    ]);
    expect(next.department).toBe("Ingeniería");
    expect(values.languages[0]).toBe(english);
  });

  it("offers the language catalog as an input suggestion list", () => {
    renderSection({ languages: [english] });

    const input = screen.getByLabelText("Idioma 1");
    expect(input).toHaveAttribute("list");
    expect(document.querySelector("datalist")).not.toBeNull();
  });

  it("adds a uniquely identified row so the model keeps stable keys", () => {
    const { onChange } = renderSection({ languages: [english] });

    fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = firstPayload(onChange);
    expect(next.languages).toEqual([
      english,
      { id: "language-2", language: "", level: "" },
    ]);
    expect(new Set(next.languages.map((item) => item.id)).size).toBe(2);
  });

  it("disables the add control at the language limit", () => {
    renderSection({ languages: [english, portuguese, french] });

    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeDisabled();
    expect(screen.getAllByLabelText(/^Idioma /u)).toHaveLength(MAX_LANGUAGES);
    expect(
      screen.getByRole("button", { name: `Quitar idioma ${MAX_LANGUAGES}` }),
    ).toBeVisible();
  });
});

describe("StrategySection layout foundation", () => {
  it("renders one migrated foundation card anchored on the canonical metadata", () => {
    renderSection();

    const card = screen
      .getByRole("heading", { level: 2, name: sectionTitle("strategy") })
      .closest('[data-slot="card"]');

    expect(card).toHaveAttribute("data-pf-section-card");
    expect(card).toHaveAttribute("id", sectionAnchorId("strategy"));
    expect(card).toHaveAttribute("data-size", "sm");
    expect(card?.className).toContain("h-fit");
    // One card only: it owns its section chrome and no legacy shell survives.
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(card?.querySelector(".size-8.rounded-xl")).toBeNull();
  });

  it("composes the shared card through the canonical section metadata", () => {
    expect(source).toMatch(/from "\.\/form-section-card"/);
    expect(source).toMatch(/<FormSectionCard/);
    expect(source).toMatch(/sectionAnchorId\("strategy"\)/);
    expect(source).toMatch(/sectionTitle\("strategy"\)/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("StrategySection boundaries", () => {
  it("reuses the isolated prototype model and documented shadcn primitives", () => {
    expect(source).toMatch(/from "\.\/prototype-model"/);
    expect(source).toMatch(/from "@\/components\/ui\/combobox"/);
    expect(source).toMatch(/from "@\/components\/ui\/select"/);
    expect(source).toMatch(/from "@\/components\/ui\/input"/);
    expect(source).toMatch(
      /addLanguageRequirement|removeLanguageRequirement|updateLanguageRequirement/,
    );
  });

  it("stays off the request contract and generates ids without runtime globals", () => {
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|VacancyFormValues|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/Math\.random|Date\.now|randomUUID|nanoid|crypto/);
  });
});

/**
 * Catalog coverage without portal churn: the caller-selected values are rendered
 * from the same catalogs the popup would offer.
 */
describe("StrategySection catalog rendering", () => {
  it("renders the caller-selected department from the shared catalog", () => {
    for (const department of ["Ingeniería", "Soporte al cliente"]) {
      expect(DEPARTMENTS).toContain(department);
      const { unmount } = renderSectionWithDepartment(department);
      expect(
        screen.getByRole("combobox", { name: "Área o departamento" }),
      ).toHaveTextContent(department);
      unmount();
    }
  });

  it("renders a removable chip and a counter for every selected technology", () => {
    const selected = SKILLS.slice(0, MAX_SKILLS);
    renderSection({ skills: selected });

    const container = chipsContainer();
    expect(container.querySelectorAll('[data-slot="combobox-chip"]')).toHaveLength(
      MAX_SKILLS,
    );
    for (const skill of selected) {
      expect(
        within(container).getByRole("button", { name: `Quitar ${skill}` }),
      ).toBeVisible();
    }
    expect(
      screen.getByText(`${MAX_SKILLS} de ${MAX_SKILLS} tecnologías seleccionadas.`),
    ).toBeVisible();
  });

  it("shows the selected CEFR level through the documented catalog label", () => {
    renderSection({ languages: [english] });
    const band = CEFR_LEVEL_OPTIONS.find((option) => option.value === "B2");
    expect(band).toBeDefined();

    expect(screen.getByRole("combobox", { name: "Nivel 1" })).toHaveTextContent(
      `B2 · ${band?.label}`,
    );
  });
});

/**
 * CEFR coverage without the anchored popup: the pure narrowing helper is
 * exhaustively tested and the real Select value change is pinned structurally,
 * so no jsdom popup churn is required to prove the routing.
 */
describe("StrategySection CEFR selection", () => {
  it("narrows every catalog band and rejects anything else", () => {
    for (const option of CEFR_LEVEL_OPTIONS) {
      expect(pickCefr(option.value)).toBe(option.value);
    }
    expect(pickCefr(null)).toBe("");
    expect(pickCefr("Z9")).toBe("");
    expect(pickCefr("b2")).toBe("");
  });

  it("routes the selected band through the real Select value change", () => {
    expect(source).toMatch(
      /onValueChange=\{\(next\) => onPatch\(\{ level: pickCefr\(next\) \}\)\}/,
    );
    expect(source).toMatch(/const LEVEL_ITEMS = CEFR_LEVEL_OPTIONS\.map/);
    expect(source).toMatch(/<SelectItem key=\{item\.value\} value=\{item\.value\}>/);
  });
});
