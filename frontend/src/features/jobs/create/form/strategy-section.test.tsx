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

import {
  ClosingDateField,
  DepartmentField,
  LanguagesField,
  SkillsField,
  capSelectedSkills,
  pickCefr,
} from "./strategy-section";
import {
  CEFR_LEVEL_OPTIONS,
  DEPARTMENTS,
  INITIAL_PROTOTYPE_VALUES,
  MAX_LANGUAGES,
  MAX_SKILLS,
  SKILLS,
} from "./prototype-model";
import type { LanguageRequirement, VacancyPrototypeValues } from "./prototype-model";

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

function valuesWith(overrides: Partial<VacancyPrototypeValues> = {}) {
  return { ...INITIAL_PROTOTYPE_VALUES, ...overrides };
}

/** The first value object handed to onChange. */
function firstPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls[0][0] as VacancyPrototypeValues;
}

function chipsContainer(): HTMLElement {
  const container = document.querySelector('[data-slot="combobox-chips"]');
  if (container === null) {
    throw new Error("The skills chips container was not rendered");
  }
  return container as HTMLElement;
}

describe("DepartmentField", () => {
  it("renders the department combobox from the shared catalog", () => {
    render(
      <DepartmentField department="Ingeniería" onChangeDepartment={vi.fn()} />,
    );

    expect(
      screen.getByRole("combobox", { name: "Área o departamento" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Área o departamento" }),
    ).toHaveTextContent("Ingeniería");
    expect(DEPARTMENTS).toContain("Ingeniería");
  });

  it("wires the department selection to its own callback", () => {
    // The real Select owns its popup; the controlled value change is pinned
    // structurally here and exercised end-to-end in vacancy-form-sections.test.
    expect(source).toMatch(
      /onValueChange=\{\(next\) => \{ if \(next !== null\) onChangeDepartment\(next\); \}\}/,
    );
  });
});

describe("StrategySection neutral Mexican placeholders", () => {
  it("states each placeholder and empty select in neutral Mexican Spanish", () => {
    render(<DepartmentField department="" onChangeDepartment={vi.fn()} />);
    expect(document.querySelector('[data-slot="select-value"]')).toHaveTextContent("Elige un área");

    cleanup();
    render(<SkillsField values={valuesWith()} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText("Busca una tecnología")).toBeVisible();

    cleanup();
    render(
      <LanguagesField
        values={valuesWith({
          languages: [{ id: "language-1", language: "", level: "" }],
        })}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-slot="select-value"]')).toHaveTextContent("Elige el nivel");
  });
});

describe("SkillsField technologies", () => {
  it("renders one removable chip per selected technology with exact names", () => {
    const onChange = vi.fn();
    render(<SkillsField values={valuesWith({ skills: ["React", "TypeScript"] })} onChange={onChange} />);
    const container = chipsContainer();

    expect(within(container).getByText("React")).toBeVisible();
    expect(within(container).getByRole("button", { name: "Quitar React" })).toBeVisible();
    expect(within(container).getByRole("button", { name: "Quitar TypeScript" })).toBeVisible();
    expect(container.querySelectorAll('[data-slot="combobox-chip"]')).toHaveLength(2);

    fireEvent.click(within(container).getByRole("button", { name: "Quitar React" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).skills).toEqual(["TypeScript"]);
  });

  it("shows how many technologies are selected out of the limit", () => {
    render(<SkillsField values={valuesWith({ skills: ["React", "TypeScript"] })} onChange={vi.fn()} />);

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

  it("renders a removable chip and a counter for every selected technology", () => {
    const selected = SKILLS.slice(0, MAX_SKILLS);
    render(<SkillsField values={valuesWith({ skills: selected })} onChange={vi.fn()} />);

    const container = chipsContainer();
    expect(container.querySelectorAll('[data-slot="combobox-chip"]')).toHaveLength(MAX_SKILLS);
    for (const skill of selected) {
      expect(within(container).getByRole("button", { name: `Quitar ${skill}` })).toBeVisible();
    }
    expect(
      screen.getByText(`${MAX_SKILLS} de ${MAX_SKILLS} tecnologías seleccionadas.`),
    ).toBeVisible();
  });
});

describe("LanguagesField languages", () => {
  it("labels every language row in Spanish and removes the right one", () => {
    const values = valuesWith({ languages: [english, portuguese] });
    const onChange = vi.fn();
    render(<LanguagesField values={values} onChange={onChange} />);

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
    const values = valuesWith({
      department: "Ingeniería",
      languages: [english, portuguese],
    });
    const onChange = vi.fn();
    render(<LanguagesField values={values} onChange={onChange} />);

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
    render(<LanguagesField values={valuesWith({ languages: [english] })} onChange={vi.fn()} />);

    const input = screen.getByLabelText("Idioma 1");
    expect(input).toHaveAttribute("list");
    expect(document.querySelector("datalist")).not.toBeNull();
  });

  it("adds a uniquely identified row so the model keeps stable keys", () => {
    const onChange = vi.fn();
    render(<LanguagesField values={valuesWith({ languages: [english] })} onChange={onChange} />);

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
    render(
      <LanguagesField
        values={valuesWith({ languages: [english, portuguese, french] })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Agregar idioma" })).toBeDisabled();
    expect(screen.getAllByLabelText(/^Idioma /u)).toHaveLength(MAX_LANGUAGES);
    expect(
      screen.getByRole("button", { name: `Quitar idioma ${MAX_LANGUAGES}` }),
    ).toBeVisible();
  });

  it("shows the selected CEFR level through the documented catalog label", () => {
    render(<LanguagesField values={valuesWith({ languages: [english] })} onChange={vi.fn()} />);
    const band = CEFR_LEVEL_OPTIONS.find((option) => option.value === "B2");
    expect(band).toBeDefined();

    expect(screen.getByRole("combobox", { name: "Nivel 1" })).toHaveTextContent(
      `B2 · ${band?.label}`,
    );
  });
});

describe("ClosingDateField", () => {
  it("renders the reusable DatePickerField rather than a native date input", () => {
    render(<ClosingDateField values={valuesWith()} onChange={vi.fn()} />);

    const closingDate = screen.getByLabelText(/fecha de cierre/iu);
    expect(closingDate).not.toHaveAttribute("type", "date");
    expect(closingDate.tagName).toBe("BUTTON");
  });

  it("reports a closing date change without mutating the caller values", () => {
    const values = valuesWith();
    const onChange = vi.fn();
    render(<ClosingDateField values={values} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/fecha de cierre/iu));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).closingDate).toBe("2026-12-31");
    expect(firstPayload(onChange)).not.toBe(values);
    expect(values.closingDate).toBe("");
  });
});

describe("StrategySection field-group boundary", () => {
  it("renders each partitioned field with no card chrome of its own", () => {
    const { container } = render(
      <div>
        <DepartmentField department="" onChangeDepartment={vi.fn()} />
        <SkillsField values={valuesWith()} onChange={vi.fn()} />
        <LanguagesField values={valuesWith()} onChange={vi.fn()} />
        <ClosingDateField values={valuesWith()} onChange={vi.fn()} />
      </div>,
    );

    // Every strategy field migrated; the wizard step shell owns the only card.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    for (const token of ["department", "skills", "languages", "closing"]) {
      expect(source).toMatch(new RegExp(`export function .*${token}`, "i"));
    }
    expect(source).not.toMatch(/from "\.\/form-section-card"/);
    expect(source).not.toMatch(/<FormSectionCard/);
    expect(source).not.toMatch(/sectionAnchorId|sectionTitle/);
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
