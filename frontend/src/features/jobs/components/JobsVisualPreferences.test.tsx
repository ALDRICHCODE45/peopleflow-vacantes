import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  EMPTY_JOBS_VISUAL_PREFERENCES,
  JobsVisualPreferences,
  type JobsVisualPreferencesValue,
} from "./JobsVisualPreferences";

/** jsdom has no PointerEvent, so the Base UI checkbox dispatches through this. */
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

/** Two surfaces sharing one local state, mirroring the sidebar and the sheet. */
function SharedSurfaces() {
  const [value, setValue] = React.useState<JobsVisualPreferencesValue>(
    EMPTY_JOBS_VISUAL_PREFERENCES,
  );
  return (
    <>
      <JobsVisualPreferences
        idPrefix="desktop-"
        value={value}
        onChange={setValue}
      />
      <JobsVisualPreferences idPrefix="mobile-" value={value} onChange={setValue} />
    </>
  );
}

describe("JobsVisualPreferences", () => {
  it("offers the compact Mexican Spanish controls with no native form names", () => {
    const { container } = render(
      <JobsVisualPreferences
        idPrefix="desktop-"
        value={EMPTY_JOBS_VISUAL_PREFERENCES}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Sueldo mínimo mensual")).toHaveAttribute(
      "type",
      "number",
    );
    expect(screen.getByLabelText("Sueldo máximo mensual")).toHaveAttribute(
      "type",
      "number",
    );
    expect(screen.getByText("Idioma de trabajo")).toBeVisible();
    expect(screen.getByText("Sin preferencia")).toBeVisible();
    for (const label of ["Seguro médico", "Horario flexible", "Formación"]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeChecked();
      expect(screen.getByText(label)).toBeVisible();
    }

    const root = container.querySelector("[data-jobs-visual-preferences]");
    expect(root).not.toBeNull();
    expect(
      root!.querySelectorAll("input[name], select[name], textarea[name]"),
    ).toHaveLength(0);
    expect(
      within(root as HTMLElement).queryByRole("button", { name: /aplicar/i }),
    ).toBeNull();
  });

  it("reports monthly range, language and benefit changes to its owner", () => {
    const onChange = vi.fn();
    render(
      <JobsVisualPreferences
        idPrefix="desktop-"
        value={EMPTY_JOBS_VISUAL_PREFERENCES}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Sueldo mínimo mensual"), {
      target: { value: "25000" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyMin: "25000" }),
    );

    fireEvent.change(screen.getByLabelText("Sueldo máximo mensual"), {
      target: { value: "60000" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ monthlyMax: "60000" }),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Formación" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        benefits: expect.objectContaining({ training: true }),
      }),
    );
  });

  it("shares one local state across the desktop and mobile surfaces with unique ids", () => {
    render(<SharedSurfaces />);

    const desktopMin = document.getElementById(
      "desktop-pref-monthly-min",
    ) as HTMLInputElement | null;
    const mobileMin = document.getElementById(
      "mobile-pref-monthly-min",
    ) as HTMLInputElement | null;
    expect(desktopMin).not.toBeNull();
    expect(mobileMin).not.toBeNull();
    expect(desktopMin).not.toBe(mobileMin);

    fireEvent.change(desktopMin!, { target: { value: "18000" } });
    expect(mobileMin!.value).toBe("18000");

    const desktopBenefitInput = document.getElementById(
      "desktop-pref-benefit-medical_insurance",
    );
    const mobileBenefitInput = document.getElementById(
      "mobile-pref-benefit-medical_insurance",
    );
    expect(desktopBenefitInput).not.toBeNull();
    expect(mobileBenefitInput).not.toBeNull();
    expect(desktopBenefitInput).not.toBe(mobileBenefitInput);

    const [desktopBenefit, mobileBenefit] = screen.getAllByRole("checkbox", {
      name: "Seguro médico",
    });
    fireEvent.click(desktopBenefit);
    expect(mobileBenefit).toBeChecked();
  });
});
