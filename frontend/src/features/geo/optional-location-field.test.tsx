import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionalLocationField } from "./optional-location-field";
vi.mock("./location-field", () => ({ LocationField: ({ disabled, postalCode }: { disabled: boolean; postalCode: boolean }) => <fieldset disabled={disabled} data-testid="location" data-postal={String(postalCode)} /> }));
afterEach(cleanup);
it("requires explicit add and clear, preserving the context depth and postal choice", () => {
  const onChange = vi.fn(); const empty = { country: null, state: null, municipality: null, postal_code: null };
  const view = render(<OptionalLocationField value={empty} onChange={onChange} depth="municipality" postalCode={false} />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByTestId("location")).toBeDisabled();
  expect(screen.getByTestId("location")).toHaveAttribute("data-postal", "false");
  fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" }));
  expect(onChange).toHaveBeenLastCalledWith({ ...empty, country: "MX" });
  view.rerender(<OptionalLocationField value={{ ...empty, country: "MX" }} onChange={onChange} depth="municipality" postalCode={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
  expect(onChange).toHaveBeenLastCalledWith(empty);
});
