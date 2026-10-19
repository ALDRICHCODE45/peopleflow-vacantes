import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { data: { items: [] } }, states: { data: { items: [] } }, municipalities: { data: { items: [] } } }) }));
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createDraftModel } from "../model";
import { initialDraftFormState } from "./draft-form-state";
import { DraftPreview } from "./draft-preview";

afterEach(cleanup);

it.each([
  { mode: "range" as const, amount: "", min: "", max: "50000.00", currency: "USD" as const, pay_period: "weekly" as const, basis: "gross" as const, expected: "Hasta $50,000 USD", cadence: "Semanal · Bruto" },
  { mode: "fixed" as const, amount: "999999999999.99", min: "", max: "", currency: "MXN" as const, pay_period: "monthly" as const, basis: "net" as const, expected: "$999,999,999,999.99 MXN", cadence: "Mensual · Neto" },
])("formats alternate compensation without changing the buffer: $expected", ({ expected, cadence, ...compensation }) => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { ...compensation, public_visible: true };
  const before = structuredClone(state);
  render(<DraftPreview state={state} />);
  expect(screen.getByText(expected)).toBeVisible();
  expect(screen.getByText(cadence)).toBeVisible();
  expect(state).toEqual(before);
});

it("does not invent missing currency, period or net/gross for an incomplete draft", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { mode: "fixed", amount: "50000", min: "", max: "", currency: "", pay_period: "", basis: "", public_visible: true };
  render(<DraftPreview state={state} />);
  expect(screen.getByText("Compensación por completar")).toBeVisible();
  expect(screen.getByText("Periodicidad sin definir · Neto/bruto sin definir")).toBeVisible();
  expect(screen.queryByText(/\$50,000/u)).toBeNull();
});

it("puts readable compensation with currency and cadence before complementary content", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation = { mode: "fixed", amount: "50000.00", min: "", max: "", currency: "MXN", pay_period: "monthly", basis: "net", public_visible: true };
  const { container } = render(<DraftPreview state={state} />);
  const pub = container.querySelector<HTMLElement>("[data-pf-draft-public]")!;
  const amount = within(pub).getByText("$50,000 MXN");
  expect(amount).toHaveClass("tabular-nums");
  expect(within(pub).getByText("Mensual · Neto")).toBeVisible();
  expect(amount.compareDocumentPosition(within(pub).getByRole("heading", { name: "Descripción" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(state.compensation.amount).toBe("50000.00");
});

it("explicitly labels an unpublished salary without leaking private amounts", () => {
  const state = initialDraftFormState(createDraftModel());
  state.compensation.amount = "51987.65";
  const { container } = render(<DraftPreview state={state} />);
  const pub = container.querySelector<HTMLElement>("[data-pf-draft-public]")!;
  expect(within(pub).getByText("Salario no publicado")).toBeVisible();
  expect(pub).not.toHaveTextContent("51987");
});

it("shows language and benefit information as text, not control-like badges", () => {
  const state = initialDraftFormState(createDraftModel());
  state.languages = [{ id: "en", language: "en", customName: "", level: "advanced" }];
  state.custom_benefits = [{ id: "benefit", value: "Café gratis" }];
  render(<DraftPreview state={state} />);
  for (const label of ["Inglés · Avanzado", "Café gratis"]) {
    expect(screen.getByText(label).closest('[data-slot="badge"]')).toBeNull();
  }
});
