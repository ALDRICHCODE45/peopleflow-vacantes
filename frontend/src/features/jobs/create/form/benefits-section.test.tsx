import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { BenefitsSection } from "./benefits-section";
import {
  BENEFIT_OPTIONS,
  INITIAL_PROTOTYPE_VALUES,
  PAY_FREQUENCY_OPTIONS,
} from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "benefits-section.tsx"), "utf8");

// jsdom implements neither matchMedia, ResizeObserver, nor PointerEvent, and the
// installed select and combobox primitives read all three while they interact.
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

function renderSection(overrides: Partial<VacancyPrototypeValues> = {}) {
  const values: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides,
  };
  const onChange = vi.fn();

  const view = render(<BenefitsSection values={values} onChange={onChange} />);

  return { ...view, values, onChange };
}

/** Renders the field group alone, exposing the container for chrome assertions. */
function renderRoot(overrides: Partial<VacancyPrototypeValues> = {}) {
  const values: VacancyPrototypeValues = {
    ...INITIAL_PROTOTYPE_VALUES,
    ...overrides,
  };
  return render(<BenefitsSection values={values} onChange={vi.fn()} />);
}

/**
 * A real controlled parent: it owns the value the way the wizard does and
 * re-renders the section after every change, so filtering, selection, and
 * removal all travel through React state instead of a static fixture.
 */
function ControlledBenefitsSection({
  initial = INITIAL_PROTOTYPE_VALUES,
  onChange,
}: {
  initial?: VacancyPrototypeValues;
  onChange?: (next: VacancyPrototypeValues) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <BenefitsSection
      values={values}
      onChange={(next) => {
        onChange?.(next);
        setValues(next);
      }}
    />
  );
}

function firstPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls[0][0] as VacancyPrototypeValues;
}

/** The most recent value handed to onChange. */
function lastPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls.at(-1)?.[0] as VacancyPrototypeValues;
}

function benefitChips(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[data-slot="combobox-chip"]'),
  ) as HTMLElement[];
}

/** The rendered option whose text matches, without walking the a11y tree. */
function optionByText(scope: Element, label: string): HTMLElement {
  const match = Array.from(
    scope.querySelectorAll('[data-slot="combobox-item"]'),
  ).find((item) => item.textContent === label);
  if (!match) {
    throw new Error(`Missing option: ${label}`);
  }
  return match as HTMLElement;
}

/** Visible option labels in the open popup. */
function optionLabels(scope: Element): string[] {
  return Array.from(
    scope.querySelectorAll('[data-slot="combobox-item"]'),
  ).map((item) => item.textContent ?? "");
}

describe("BenefitsSection benefit selection", () => {
  it("renders one searchable combobox over the benefit catalog instead of a checkbox grid", () => {
    renderSection();

    // The step shell owns the heading; this module is a card-less field group.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("group", { name: "Beneficios" })).toBeVisible();

    const benefits = screen.getByRole("combobox", { name: "Beneficios" });
    expect(benefits).toBeVisible();
    expect(benefits).toHaveAttribute("placeholder", "Busca un beneficio");
    // The eight always-visible checkboxes are gone.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByText(
        `0 de ${BENEFIT_OPTIONS.length} beneficios seleccionados.`,
      ),
    ).toBeVisible();
  });

  it("reflects the controlled benefit selection as compact removable chips", () => {
    renderSection({ benefits: ["health_insurance", "annual_bonus"] });

    const chips = benefitChips();
    expect(chips).toHaveLength(2);
    expect(within(chips[0]).getByRole("button", { name: "Quitar Seguro de salud" })).toBeVisible();
    expect(within(chips[1]).getByRole("button", { name: "Quitar Bono anual" })).toBeVisible();
    expect(
      screen.getByText(
        `2 de ${BENEFIT_OPTIONS.length} beneficios seleccionados.`,
      ),
    ).toBeVisible();
  });

  it("removes one selected benefit through onChange without mutating the caller values", () => {
    const { values, onChange } = renderSection({
      benefits: ["health_insurance", "annual_bonus"],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Seguro de salud" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).benefits).toEqual(["annual_bonus"]);
    expect(firstPayload(onChange)).not.toBe(values);
    expect(values.benefits).toEqual(["health_insurance", "annual_bonus"]);
  });

  it("keeps the remaining benefits in catalog order after a removal", () => {
    const { onChange } = renderSection({
      benefits: ["annual_bonus", "health_insurance", "computer_equipment"],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Seguro de salud" }),
    );

    // Catalog order, not click order: equipo de cómputo precedes bono anual.
    expect(lastPayload(onChange).benefits).toEqual([
      "computer_equipment",
      "annual_bonus",
    ]);
  });

  it("shows the controlled selection in catalog order without mutating the caller values", () => {
    const { values } = renderSection({
      benefits: ["annual_bonus", "computer_equipment"],
    });

    // The model already promises catalog order; the display honours it too.
    expect(benefitChips().map((chip) => chip.textContent)).toEqual([
      "Equipo de cómputo",
      "Bono anual",
    ]);
    expect(values.benefits).toEqual(["annual_bonus", "computer_equipment"]);
  });

  it("keeps the same set when the caller value never changes", () => {
    const { values, onChange } = renderSection({
      benefits: ["annual_bonus", "health_insurance"],
    });

    // Controlled and unchanged: each removal starts from the caller's own value.
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Seguro de salud" }),
    );

    expect(lastPayload(onChange).benefits).toEqual(["annual_bonus"]);
    expect(values.benefits).toEqual(["annual_bonus", "health_insurance"]);
  });
});

describe("BenefitsSection pay frequency", () => {
  it("offers the three documented Spanish frequencies through one select", () => {
    renderSection();

    const frequency = screen.getByRole("combobox", { name: "Frecuencia de pago" });
    expect(frequency).toBeVisible();
    const value = frequency.querySelector('[data-slot="select-value"]');
    expect(value).toHaveAttribute("data-placeholder");
    expect(value).toHaveTextContent("Elige una frecuencia");

    // The always-visible toggle buttons are gone; the catalog still owns them.
    for (const option of PAY_FREQUENCY_OPTIONS) {
      expect(screen.queryByRole("button", { name: option.label })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Quincenal" })).toBeNull();
  });
});

describe("BenefitsSection field-group boundary", () => {
  it("renders one field group with no card chrome of its own", () => {
    const { container } = renderRoot();

    // The wizard step shell owns the single card of the step.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(container.querySelector('[data-slot="field-group"]')).not.toBeNull();
  });

  it("keeps the card out of the field group and delegates chrome to the step", () => {
    expect(source).not.toMatch(/from "\.\/form-section-card"/);
    expect(source).not.toMatch(/<FormSectionCard/);
    expect(source).not.toMatch(/sectionAnchorId|sectionTitle/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("BenefitsSection boundaries", () => {
  it("builds the option sets from the catalogs and documented primitives", () => {
    expect(source).toMatch(/from "\.\/prototype-model"/);
    expect(source).toMatch(/from "@\/components\/ui\/combobox"/);
    expect(source).toMatch(/from "@\/components\/ui\/select"/);
    expect(source).toMatch(/BENEFIT_OPTIONS/);
    expect(source).toMatch(/PAY_FREQUENCY_OPTIONS/);
    expect(source).toMatch(/<Combobox\b/);
    expect(source).toMatch(/<SelectItem/);
    // The root owns the catalog (so Base UI filters it) and the list renders the
    // filtered collection through a function child instead of fixed children.
    expect(source).toMatch(/items=\{BENEFIT_OPTIONS\}/);
    expect(source).toMatch(/<ComboboxList>[\s\S]*?\{\(option/u);
    // Neither retired option-set primitive survives in this section.
    expect(source).not.toMatch(/checkbox|ToggleGroup/i);
    // No hand-rolled button loop for the benefit option set.
    expect(source).not.toMatch(/BENEFIT_OPTIONS\.map\([\s\S]*?<Button/u);
  });

  it("stays off the request contract and the network layer", () => {
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});

/**
 * The anchored popup composition, kept last on purpose.
 *
 * Opening the portal popup under jsdom repositions for seconds and leaks that
 * cost into whatever runs next; a long enough popup pass also makes Vitest's
 * worker RPC time out. The popup assertions are therefore kept to two small
 * passes that each prove one behaviour: the first keeps the list open through a
 * selection so a second search and a removal can be driven in one session, the
 * second covers the empty state. The popup has no jsdom layout, so options are
 * proven by document presence and the selection callback, not by visibility.
 */
describe("BenefitsSection benefit search", () => {
  /** Opens the input-owned popup and types a query into the chips input. */
  function openSearch(query: string) {
    const input = screen.getByRole("combobox", { name: "Beneficios" });
    // Base UI opens the popup on mousedown and filters on input.
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: query } });
    return input;
  }

  it("filters by label, then immediately searches and removes from a controlled parent", () => {
    const onChange = vi.fn();
    render(<ControlledBenefitsSection onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Beneficios" });

    // Base UI opens the popup on mousedown and filters on input.
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: "Seguro" } });

    // The live query owns the filtered collection, independently of the
    // popup's retained close query. Exact close/reopen timing is browser-tested.
    const popup = document.querySelector(
      '[data-slot="combobox-content"]',
    ) as HTMLElement;
    expect(popup).not.toBeNull();
    expect(source).toContain("filteredItems={filteredBenefits}");
    expect(source).toContain("inputValue={query}");
    expect(source).toContain("onInputValueChange={setQuery}");

    // A matching query keeps only the matching catalog benefit in the list.
    expect(optionLabels(popup)).toEqual(["Seguro de salud"]);

    // Select that benefit without a filter in the way: an unfiltered multiple
    // selection keeps this list open, so the next search happens in the same
    // popup session instead of a remount.
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(optionByText(popup, "Seguro de salud"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).benefits).toEqual(["health_insurance"]);
    expect(benefitChips().map((chip) => chip.textContent)).toEqual([
      "Seguro de salud",
    ]);

    // Immediately search again, without blurring or refocusing the input. A real
    // keystroke fires an `input` event carrying `inputType`, and the live query
    // must own the list from here on.
    fireEvent.input(input, {
      target: { value: "equipo" },
      inputType: "insertText",
    });
    expect(optionLabels(popup)).toEqual(["Equipo de cómputo"]);

    fireEvent.click(optionByText(popup, "Equipo de cómputo"));
    // Catalog order holds after a filtered selection.
    expect(benefitChips().map((chip) => chip.textContent)).toEqual([
      "Seguro de salud",
      "Equipo de cómputo",
    ]);

    // Removal still works from the same controlled parent.
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar Seguro de salud" }),
    );
    expect(benefitChips().map((chip) => chip.textContent)).toEqual([
      "Equipo de cómputo",
    ]);
    expect(
      screen.getByText(
        `1 de ${BENEFIT_OPTIONS.length} beneficios seleccionados.`,
      ),
    ).toBeVisible();
  });

  it("surfaces the empty state and recovers when the query stops matching", () => {
    renderSection();

    const input = openSearch("zzz");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      document.querySelector('[data-slot="combobox-content"]'),
    ).toHaveAttribute("data-empty");
    expect(screen.getByText(/Sin resultados/u)).toBeInTheDocument();

    // Clearing the query recovers the full catalog.
    fireEvent.change(input, { target: { value: "" } });
    expect(
      screen.getByRole("option", { name: "Bono anual" }),
    ).toBeInTheDocument();
  });
});
