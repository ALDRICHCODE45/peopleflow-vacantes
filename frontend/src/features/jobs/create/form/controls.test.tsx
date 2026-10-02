import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OptionField } from "./controls";
import { EMPLOYMENT_TYPE_OPTIONS, controlId, errorId } from "./model";
import type { EmploymentType } from "../../formatters";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "controls.tsx"), "utf8");

// jsdom implements neither matchMedia, ResizeObserver, nor PointerEvent, and the
// installed Select primitive reads them while it opens.
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

function renderField(
  overrides: {
    value?: EmploymentType | "";
    error?: string;
  } = {},
) {
  const onChange = vi.fn();

  render(
    <OptionField<EmploymentType>
      field="employment_type"
      title="Jornada"
      options={EMPLOYMENT_TYPE_OPTIONS}
      value={overrides.value ?? ""}
      error={overrides.error}
      onChange={onChange}
    />,
  );

  return { onChange };
}

describe("OptionField select surface", () => {
  it("renders one labelled combobox trigger for the contract enum", () => {
    renderField();

    const trigger = screen.getByRole("combobox", { name: "Jornada" });
    expect(trigger).toBeVisible();
    // The field id, the accessible name, and the 40px target all survive.
    expect(trigger).toHaveAttribute("id", controlId("employment_type"));
    expect(trigger).toHaveClass("h-10");
    expect(trigger).toHaveAttribute("aria-invalid", "false");
  });

  it("shows the current option's Spanish label in the trigger", () => {
    renderField({ value: "full_time" });

    expect(screen.getByRole("combobox", { name: "Jornada" })).toHaveTextContent(
      "Tiempo completo",
    );
  });

  it("shows a placeholder while the enum is unchosen", () => {
    renderField();

    const value = document.querySelector('[data-slot="select-value"]');
    expect(value).not.toBeNull();
    expect(value).toHaveAttribute("data-placeholder");
    expect(value).toHaveTextContent("Elige una opción");
  });

  it("wires the field error to the trigger", () => {
    renderField({ error: "Elige una jornada de trabajo." });

    const trigger = screen.getByRole("combobox", { name: "Jornada" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveClass("text-foreground");
    expect(trigger).toHaveAttribute(
      "aria-describedby",
      errorId("employment_type"),
    );
    expect(
      document.getElementById(errorId("employment_type")),
    ).toHaveTextContent("Elige una jornada de trabajo.");
  });

  it("reflects the caller-owned value and never owns it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OptionField<EmploymentType>
        field="employment_type"
        title="Jornada"
        options={EMPLOYMENT_TYPE_OPTIONS}
        value="full_time"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Jornada" })).toHaveTextContent(
      "Tiempo completo",
    );

    // The trigger follows the prop, so the control owns no selection state.
    rerender(
      <OptionField<EmploymentType>
        field="employment_type"
        title="Jornada"
        options={EMPLOYMENT_TYPE_OPTIONS}
        value="internship"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Jornada" })).toHaveTextContent(
      "Beca",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("OptionField primitive boundary", () => {
  it("builds the enum control from the installed Select, not a choice grid", () => {
    expect(source).toMatch(/from "@\/components\/ui\/select"/);
    expect(source).toMatch(/<SelectItem key=\{option\.value\} value=\{option\.value\}>/);
    expect(source).toMatch(/<SelectContent>/);
    expect(source).toMatch(/<SelectGroup>/);
    expect(source).not.toMatch(/choice-grid|ChoiceGrid|ToggleGroup/);
  });
});

/**
 * The real installed popup, kept last on purpose: its anchored positioner costs
 * seconds in jsdom and leaks into whichever test runs next.
 */
describe("OptionField installed popup", () => {
  it("reports the chosen contract value through onChange", () => {
    const { onChange } = renderField();

    fireEvent.click(screen.getByRole("combobox", { name: "Jornada" }));
    fireEvent.click(screen.getByRole("option", { name: "Tiempo completo" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("full_time");
  });
});
