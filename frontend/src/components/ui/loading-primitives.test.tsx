import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";

afterEach(cleanup);

describe("loading primitives", () => {
  it("exposes the official spinner with a contextual accessible name", () => {
    render(<Spinner aria-label="Guardando cambios" />);
    expect(screen.getByRole("status", { name: "Guardando cambios" })).toHaveAttribute(
      "data-slot", "spinner",
    );
  });

  it("keeps skeleton geometry composable and decorative placeholders silent", () => {
    const { container } = render(
      <Skeleton aria-hidden="true" className="h-6 w-48" />,
    );
    const skeleton = container.querySelector('[data-slot="skeleton"]');
    expect(skeleton).toHaveClass("h-6", "w-48", "bg-muted");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
