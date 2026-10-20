import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OptionalLocationField } from "./optional-location-field";
vi.mock("./location-field", () => ({ LocationField: ({ disabled, postalCode }: { disabled: boolean; postalCode: boolean }) => <fieldset disabled={disabled} data-testid="location" data-postal={String(postalCode)} /> }));
afterEach(cleanup);
it("allows immediate country selection and explicit clearing, preserving postal choice", () => {
  const onChange = vi.fn(); const empty = { country: null, state: null, municipality: null, postal_code: null };
  const view = render(<OptionalLocationField value={empty} onChange={onChange} depth="municipality" postalCode={false} />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByTestId("location")).not.toBeDisabled();
  expect(screen.getByTestId("location")).toHaveAttribute("data-postal", "false");
  expect(screen.queryByRole("button", { name: "Agregar ubicación" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Quitar ubicación" })).not.toBeInTheDocument();
  view.rerender(<OptionalLocationField value={{ ...empty, country: "MX" }} onChange={onChange} depth="municipality" postalCode={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
  expect(onChange).toHaveBeenLastCalledWith(empty);
});
