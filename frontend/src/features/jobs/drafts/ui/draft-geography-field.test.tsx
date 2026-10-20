import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DraftGeographyField } from "./draft-geography-field";
import { createDraftModel } from "../model";
import { initialDraftFormState } from "./draft-form-state";
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }] }, retry: vi.fn() }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
vi.mock("@/components/ui/combobox", async original => ({ ...await original<typeof import("@/components/ui/combobox")>(), ComboboxContent: ({ children }: { children: ReactNode }) => <div data-slot="combobox-content">{children}</div> }));
afterEach(cleanup);
function Harness() {
  const [state, setState] = useState(() => ({ ...initialDraftFormState(createDraftModel()), work_mode: "remote" }));
  return <><DraftGeographyField state={state} onChange={patch => setState(previous => ({ ...previous, ...patch }))} /><button onClick={() => setState(previous => ({ ...previous, work_mode: previous.work_mode === "remote" ? "hybrid" : "remote" }))}>Cambiar modalidad</button><output data-testid="state">{JSON.stringify(state)}</output></>;
}
it("allows clearing an optional remote location without re-defaulting it", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
  expect(JSON.parse(screen.getByTestId("state").textContent!).location.country).toBeNull();
});
it("keeps ordered country selection and chips across mode switches", async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Solo desde estos países" }));
  const group = screen.getByText("¿Desde dónde pueden postular?").closest("fieldset")!;
  const input = within(group).getByRole("combobox", { name: "Países desde donde pueden postular" });
  await user.type(input, "Colombia"); await user.click(within(group).getByRole("option", { name: "Colombia" }));
  await user.clear(input); await user.type(input, "México"); await user.click(within(group).getByRole("option", { name: "México" }));
  expect(JSON.parse(screen.getByTestId("state").textContent!).remote_scope).toEqual({ kind: "countries", countries: ["CO", "MX"] });
  await user.click(screen.getByRole("button", { name: "Cambiar modalidad" }));
  expect(screen.queryByText("¿Desde dónde pueden postular?")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cambiar modalidad" }));
  expect(screen.getByRole("button", { name: "Quitar Colombia" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Quitar Colombia" }));
  expect(JSON.parse(screen.getByTestId("state").textContent!).remote_scope).toEqual({ kind: "countries", countries: ["MX"] });
  await user.click(screen.getByRole("button", { name: "Desde cualquier lugar" }));
  expect(JSON.parse(screen.getByTestId("state").textContent!).remote_scope).toEqual({ kind: "anywhere" });
  await user.click(screen.getByRole("button", { name: "Solo desde estos países" }));
  expect(JSON.parse(screen.getByTestId("state").textContent!).remote_scope).toEqual({ kind: "countries", countries: ["MX"] });
});
it("renders optional remote location and the official chips composition with named countries", () => {
 const state = initialDraftFormState(createDraftModel());
 state.work_mode = "remote";
 state.remote_scope = { kind: "countries", countries: ["CO"] };
 state.remoteCountries = [{ id: "CO", name: "Colombia" }];
 const { container } = render(<DraftGeographyField state={state} onChange={vi.fn()} />);
 expect(screen.getByText("Ubicación (opcional)")).toBeInTheDocument();
 expect(screen.getByText("Para vacantes remotas la ubicación es opcional.")).toBeInTheDocument();
 expect(screen.getByText("¿Desde dónde pueden postular?")).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Quitar Colombia" })).toBeInTheDocument();
 expect(container.querySelector('[data-slot="combobox-chips"] [data-slot="combobox-chip"]')).not.toBeNull();
});
it.each([
 ["empty", "Elige al menos un país."], ["duplicate", "Quita los países repetidos."], ["too_many", "Puedes elegir hasta 50 países."], ["unknown_country", "Elige países de la lista."],
] as const)("maps %s to the countries control", (reason, copy) => {
 const state = initialDraftFormState(createDraftModel()); state.work_mode = "remote"; state.remote_scope = { kind: "countries", countries: [] };
 render(<DraftGeographyField state={state} onChange={vi.fn()} errors={{ location: [], remoteScope: [{ field: "countries", index: 0, reason }] }} />);
 expect(screen.getByText(copy)).toHaveAttribute("data-slot", "field-error");
 expect(screen.getByRole("combobox", { name: "Países desde donde pueden postular" })).toHaveAttribute("aria-invalid", "true");
});
it("hides scope onsite and marks MX levels required", () => {
 const state = initialDraftFormState(createDraftModel()); state.work_mode = "onsite"; state.location.country = "MX";
 render(<DraftGeographyField state={state} onChange={vi.fn()} />);
 expect(screen.queryByText("¿Desde dónde pueden postular?")).not.toBeInTheDocument();
 expect(screen.getByRole("combobox", { name: "Estado" })).toHaveAttribute("aria-required", "true");
});

it("places the two remote scope choices side by side (stacked only on small screens)", () => {
  // User: «los dos botones de "Desde cualquier lugar" y "Solo desde estos paises" ocupan espacio innecesario … uno al lado del otro».
  render(<Harness />);
  const group = screen.getByRole("button", { name: "Desde cualquier lugar" }).closest('[data-slot="toggle-group"]')!;
  expect(group).toHaveAttribute("data-orientation", "horizontal");
  expect(group).toHaveClass("grid", "sm:grid-cols-2");
});
