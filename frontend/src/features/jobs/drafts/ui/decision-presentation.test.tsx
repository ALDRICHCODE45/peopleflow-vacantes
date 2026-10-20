import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { data: { items: [] } }, states: { data: { items: [] } }, municipalities: { data: { items: [] } } }) }));
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createDraftModel } from "../model";
import { initialDraftFormState } from "./draft-form-state";
import { DraftPublicDetail } from "./draft-public-detail";
import { internalCompensationView } from "./draft-preview";

afterEach(cleanup);

it.each([
  { mode: "range", amount: "", min: "", max: "50000.00", currency: "USD", pay_period: "weekly", basis: "gross", expected: "Hasta $50,000 USD", cadence: "Semanal · Bruto" },
  { mode: "fixed", amount: "999999999999.99", min: "", max: "", currency: "MXN", pay_period: "monthly", basis: "net", expected: "$999,999,999,999.99 MXN", cadence: "Mensual · Neto" },
])("keeps exact internal amounts without changing the buffer: $expected", ({ expected, cadence, ...compensation }) => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { ...compensation, public_visible: false };
  const before = structuredClone(state);
  expect(internalCompensationView(state.compensation)).toEqual({ amount: expected, meta: cadence });
  expect(state).toEqual(before);
});

it("does not invent missing currency, period or net/gross in internal review", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { mode: "fixed", amount: "50000", min: "", max: "", currency: "", pay_period: "", basis: "", public_visible: true };
  expect(internalCompensationView(state.compensation)).toEqual({ amount: "$50,000 · Moneda sin definir", meta: "Periodicidad sin definir · Neto/bruto sin definir" });
});

it("uses the public salary formatting and puts compensation alongside the application action", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { mode: "fixed", amount: "50000.00", min: "", max: "", currency: "MXN", pay_period: "monthly", basis: "net", public_visible: true };
  render(<DraftPublicDetail state={state} />);
  const amount = screen.getByText("$50,000");
  expect(amount).toHaveClass("tabular-nums");
  expect(screen.getByText("Mensual · Neto")).toBeVisible();
  expect(amount.closest("aside")).toContainElement(screen.getByRole("button", { name: "Disponible al publicar" }));
  expect(state.compensation.amount).toBe("50000.00");
});

it("explicitly labels an unpublished salary without leaking private amounts", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation.amount = "51987.65";
  const { container } = render(<DraftPublicDetail state={state} />);
  expect(screen.getByText("Salario no publicado")).toBeVisible();
  expect(container).not.toHaveTextContent("51987");
});

it("shows public benefit information as text, not a control-like badge", () => {
  const state = initialDraftFormState(createDraftModel());
  state.custom_benefits = [{ id: "benefit", value: "Café gratis" }];
  render(<DraftPublicDetail state={state} />);
  expect(screen.getByText("Café gratis").closest('[data-slot="badge"]')).toBeNull();
});
