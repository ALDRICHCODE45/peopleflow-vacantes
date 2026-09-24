import { readFileSync } from "node:fs";
import { useState } from "react";
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

import { BenefitsSection } from "./benefits-section";
import { sectionAnchorId, sectionTitle } from "./section-metadata";
import {
  BENEFIT_OPTIONS,
  INITIAL_PROTOTYPE_VALUES,
  PAY_FREQUENCY_OPTIONS,
} from "./prototype-model";
import type { VacancyPrototypeValues } from "./prototype-model";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "benefits-section.tsx"), "utf8");

/**
 * jsdom implements neither PointerEvent nor the modifier-aware click the Base UI
 * checkbox dispatches, so the checkbox reports its change through this stand-in.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
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

  render(<BenefitsSection values={values} onChange={onChange} />);

  return { values, onChange };
}

function firstPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls[0][0] as VacancyPrototypeValues;
}

/** The most recent value handed to onChange. */
function lastPayload(onChange: ReturnType<typeof vi.fn>): VacancyPrototypeValues {
  return onChange.mock.calls.at(-1)?.[0] as VacancyPrototypeValues;
}

describe("BenefitsSection benefit selection", () => {
  it("renders every catalog benefit as a labelled checkbox in a fieldset", () => {
    renderSection();

    expect(
      screen.getByRole("heading", { name: "Beneficios y frecuencia de pago" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Beneficios" })).toBeVisible();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(BENEFIT_OPTIONS.length);
    for (const option of BENEFIT_OPTIONS) {
      expect(screen.getByRole("checkbox", { name: option.label })).toBeVisible();
    }
  });

  it("reflects the controlled benefit selection", () => {
    renderSection({ benefits: ["health_insurance", "annual_bonus"] });

    expect(
      screen.getByRole("checkbox", { name: "Seguro de salud" }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bono anual" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Equipo de cómputo" }),
    ).not.toBeChecked();
  });

  it("adds one benefit through onChange without mutating the caller values", () => {
    const { values, onChange } = renderSection();

    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro de salud" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).benefits).toEqual(["health_insurance"]);
    expect(firstPayload(onChange)).not.toBe(values);
    expect(values.benefits).toEqual([]);
  });

  it("adds and removes benefits in catalog order through a real state round-trip", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [values, setValues] = useState<VacancyPrototypeValues>({
        ...INITIAL_PROTOTYPE_VALUES,
        benefits: ["annual_bonus", "health_insurance"],
      });
      return (
        <BenefitsSection
          values={values}
          onChange={(next) => {
            onChange(next);
            setValues(next);
          }}
        />
      );
    }

    render(<Controlled />);

    // Adding a third benefit reorders the whole set into catalog order.
    fireEvent.click(screen.getByRole("checkbox", { name: "Equipo de cómputo" }));
    expect(lastPayload(onChange).benefits).toEqual([
      "health_insurance",
      "computer_equipment",
      "annual_bonus",
    ]);

    // Removing a checked benefit drops only that entry.
    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro de salud" }));
    expect(lastPayload(onChange).benefits).toEqual([
      "computer_equipment",
      "annual_bonus",
    ]);

    // The controlled surface really reflects the committed state.
    expect(screen.getByRole("checkbox", { name: "Equipo de cómputo" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bono anual" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Seguro de salud" }),
    ).not.toBeChecked();
  });

  it("keeps the same set when the caller value never changes", () => {
    const { values, onChange } = renderSection({
      benefits: ["annual_bonus", "health_insurance"],
    });

    // Controlled and unchanged: each click starts from the caller's own value.
    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro de salud" }));

    expect(lastPayload(onChange).benefits).toEqual(["annual_bonus"]);
    expect(values.benefits).toEqual(["annual_bonus", "health_insurance"]);
  });
});

describe("BenefitsSection pay frequency", () => {
  it("offers exactly the three documented Spanish frequencies", () => {
    renderSection();

    const group = screen.getByRole("group", { name: "Frecuencia de pago" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(PAY_FREQUENCY_OPTIONS.map((option) => option.label));
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Quincenal" })).toBeNull();
  });

  it("reports the chosen frequency through onChange", () => {
    const { onChange } = renderSection();

    fireEvent.click(
      within(screen.getByRole("group", { name: "Frecuencia de pago" })).getByRole(
        "button",
        { name: "Anual" },
      ),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(firstPayload(onChange).payFrequency).toBe("yearly");
    expect(lastPayload(onChange).payFrequency).toBe("yearly");

    fireEvent.click(
      within(screen.getByRole("group", { name: "Frecuencia de pago" })).getByRole(
        "button",
        { name: "Por hora" },
      ),
    );

    expect(lastPayload(onChange).payFrequency).toBe("hourly");
  });
});

describe("BenefitsSection layout foundation", () => {
  it("renders one migrated foundation card anchored on the canonical metadata", () => {
    renderSection();

    const card = screen
      .getByRole("heading", {
        level: 2,
        name: sectionTitle("benefits-pay-frequency"),
      })
      .closest('[data-slot="card"]');

    expect(card).toHaveAttribute("data-pf-section-card");
    expect(card).toHaveAttribute(
      "id",
      sectionAnchorId("benefits-pay-frequency"),
    );
    expect(card).toHaveAttribute("data-size", "sm");
    expect(card?.className).toContain("h-fit");
    // One card only: it owns its section chrome and no legacy shell survives.
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(card?.querySelector(".size-8.rounded-xl")).toBeNull();
  });

  it("composes the shared card through the canonical section metadata", () => {
    expect(source).toMatch(/from "\.\/form-section-card"/);
    expect(source).toMatch(/<FormSectionCard/);
    expect(source).toMatch(/sectionAnchorId\("benefits-pay-frequency"\)/);
    expect(source).toMatch(/sectionTitle\("benefits-pay-frequency"\)/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("BenefitsSection boundaries", () => {
  it("builds the option sets from the catalogs and documented primitives", () => {
    expect(source).toMatch(/from "\.\/prototype-model"/);
    expect(source).toMatch(/from "@\/components\/ui\/checkbox"/);
    expect(source).toMatch(/from "@\/components\/ui\/toggle-group"/);
    expect(source).toMatch(/BENEFIT_OPTIONS/);
    expect(source).toMatch(/PAY_FREQUENCY_OPTIONS/);
    expect(source).toMatch(/<FieldSet/);
    expect(source).toMatch(/<FieldLegend/);
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
