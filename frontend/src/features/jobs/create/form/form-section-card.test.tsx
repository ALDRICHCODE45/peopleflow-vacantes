import { WalletIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { FormSectionCard } from "./form-section-card";

afterEach(cleanup);

describe("FormSectionCard", () => {
  it("names the section with one level-two title over a decorative icon", () => {
    const { container } = render(
      <FormSectionCard
        id="vacancy-section-compensation"
        icon={WalletIcon}
        title="Compensación"
      >
        <p>Salario</p>
      </FormSectionCard>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Compensación" }),
    ).toBeVisible();
    expect(container.querySelector('[data-slot="card-content"]')).toContainElement(
      screen.getByText("Salario"),
    );
    // The icon decorates the heading; the heading alone names the section.
    expect(
      container.querySelector('[data-slot="card-header"] svg')?.closest("[aria-hidden]"),
    ).not.toBeNull();
    expect(container.querySelector("#vacancy-section-compensation")).not.toBeNull();

    // The heading is the navigator's focus target, never a new tab stop, and the
    // card clears the sticky bar it scrolls under.
    expect(screen.getByRole("heading", { level: 2, name: "Compensación" })).toHaveAttribute("tabindex", "-1");
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(1);
    expect(container.querySelector("#vacancy-section-compensation")?.className).toContain("scroll-mt-24");
  });
});
