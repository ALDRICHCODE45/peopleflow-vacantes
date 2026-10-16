import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { fromManagement, setRequestDate } from "@/features/jobs/drafts/pipeline/management-model";
import { ManagementDateField } from "./date-field";
import { managementFixture } from "./test-fixture";
// Closed popup tests use the real trigger and Field primitives.
afterEach(cleanup);
it("associates a changed future-date error with the first date control", () => {
  const state = setRequestDate(fromManagement(managementFixture()), "2026-10-17");
  render(<ManagementDateField state={state} error="future" disabled={false} onChange={vi.fn()} />);
  const field = screen.getByRole("button", { name: "Fecha de solicitud" });
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription("Cuándo te pidieron cubrir esta vacante. Puede ser hoy o una fecha pasada. Elige hoy o una fecha pasada.");
  expect(screen.getByText("Elige hoy o una fecha pasada.")).toHaveAttribute("data-slot", "field-error");
  expect(field.closest('[data-slot="field"]')).toHaveAttribute("data-invalid", "true");
});
it("does not invent an error for an unchanged stored future date and allows clearing it", () => {
  const change = vi.fn(); const state = fromManagement({ ...managementFixture(), requestDate: "2028-01-01" });
  render(<ManagementDateField state={state} disabled={false} onChange={change} />);
  expect(screen.getByRole("button", { name: "Fecha de solicitud" })).toHaveAttribute("aria-invalid", "false");
  expect(screen.queryByText("Elige hoy o una fecha pasada.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Quitar fecha" })); expect(change).toHaveBeenCalledExactlyOnceWith(null);
});
it("disables both date actions while pending", () => {
  render(<ManagementDateField state={fromManagement({ ...managementFixture(), requestDate: "2026-10-16" })} disabled onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Fecha de solicitud" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Quitar fecha" })).toBeDisabled();
});
