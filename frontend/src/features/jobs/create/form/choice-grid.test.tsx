import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ChoiceGrid, ChoiceGridItem } from "./choice-grid";

afterEach(cleanup);

describe("ChoiceGrid", () => {
  it("maps declared columns to a responsive grid that contains long labels", () => {
    const { container } = render(
      <ChoiceGrid columns={3} aria-label="Jornada">
        <ChoiceGridItem value="full_time" variant="outline" size="sm">
          Tiempo completo
        </ChoiceGridItem>
      </ChoiceGrid>,
    );

    const group = screen.getByRole("group", { name: "Jornada" });
    expect(container.querySelector("[data-pf-choice-grid]")).toBe(group);
    expect(group.className).toContain("sm:grid-cols-3");

    const choice = within(group).getByRole("button", {
      name: "Tiempo completo",
    });
    expect(choice.className).toContain("min-w-0");
    expect(choice.className).toContain("whitespace-normal");
    expect(choice.className).not.toContain("whitespace-nowrap");
  });
});
