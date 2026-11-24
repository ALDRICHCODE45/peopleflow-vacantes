import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Field } from "./field";

afterEach(cleanup);

// axe color-contrast: the invalid Field painted its typed text text-destructive (#e7000b) on the #f2eff7 input = 4.19:1.
// status-danger is 7.3:1 on the light input and 7.7:1 on the dark card, so every invalid field passes.
it("paints an invalid field with the status-danger token, never text-destructive", () => {
  render(<Field data-invalid="true" data-testid="field" />);
  const field = screen.getByTestId("field");
  expect(field).toHaveClass("data-[invalid=true]:text-status-danger");
  expect(field).not.toHaveClass("data-[invalid=true]:text-destructive");
});
