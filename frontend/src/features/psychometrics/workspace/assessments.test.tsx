import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StandaloneAssessments } from "./assessments";
afterEach(cleanup);
it("keeps additional assessments hidden without invitations (L6)", () => {
  const { container } = render(<StandaloneAssessments items={[]} />);
  expect(screen.queryByRole("heading", { name: /Evaluaciones adicionales/ })).toBeNull();
  expect(screen.queryByRole("region", { name: "Evaluaciones" })).toBeNull();
  expect(container.querySelector('[data-slot="empty"]')).toBeNull();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  expect(container).toBeEmptyDOMElement();
});
