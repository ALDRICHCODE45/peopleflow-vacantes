import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VacancyWithKind } from "./process-kind";

afterEach(cleanup);

it("renders the title alone without a kind (old backend) or for an original", () => {
  const { container, rerender } = render(<VacancyWithKind><a href="/v">Supervisor(a)</a></VacancyWithKind>);
  expect(container.firstElementChild?.tagName).toBe("A");
  rerender(<VacancyWithKind kind="original"><a href="/v">Supervisor(a)</a></VacancyWithKind>);
  expect(screen.queryByText("Reemplazo")).not.toBeInTheDocument();
});
it("wraps a replacement's badge onto its own line when the cell is narrow instead of overlapping the title", () => {
  render(<VacancyWithKind kind="replacement" className="custom"><a href="/v">Supervisor(a) de Almacén</a></VacancyWithKind>);
  const wrapper = screen.getByRole("link").parentElement;
  expect(wrapper).toHaveClass("flex-wrap", "min-w-0", "max-w-full", "custom");
  expect(wrapper).toContainElement(screen.getByText("Reemplazo"));
});
