import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
// Match the installed primitive tests: jsdom's anchored portal repositions in a
// loop. Keep real inputs, filtering, items and selection; replace positioning only.
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div data-slot="combobox-content">{children}</div>,
}));
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationField, type LocationFieldProps } from "./location-field";
import { locationValueToWrite, type LocationValue } from "./model";
import { OptionalLocationField } from "./optional-location-field";
const empty: LocationValue = { country: null, state: null, municipality: null, postal_code: null };
const states = [{ id: "01", name: "Aguascalientes" }, { id: "02", name: "Baja California" }];
const towns = [{ id: "01001", name: "Aguascalientes" }, { id: "01002", name: "Asientos" }];
const pair = (index = 0) => ({ state: states[0], municipality: towns[index] });
const fetcher = vi.fn(async (url: string) => {
  if (url.endsWith("/countries")) return Response.json({ items: [{ id: "MX", name: "México" }, { id: "US", name: "Estados Unidos" }] });
  if (url.endsWith("/states")) return Response.json({ items: states });
  if (url.endsWith("/municipalities")) return Response.json({ items: towns });
  const cp = url.split("/").at(-1);
  if (cp === "99999") return Response.json({ code: "postal_code_not_found" }, { status: 404 });
  return Response.json({ postal_code: cp, matches: cp === "02000" ? [pair(), pair(1)] : [pair()] });
});
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Harness(props: Partial<LocationFieldProps> & { initial?: LocationValue }) {
  const [value, setValue] = useState(props.initial ?? empty);
  return <><LocationField depth="municipality" postalCode label="Ubicación" {...props} value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}
function OptionalHarness() {
  const [value, setValue] = useState(empty);
  return <><OptionalLocationField depth="municipality" postalCode value={value} onChange={setValue} /><output data-testid="value">{JSON.stringify(locationValueToWrite(value))}</output></>;
}
it("offers an enabled empty country without opt-in, and clears explicitly to null", async () => {
  render(<OptionalHarness />);
  const country = await screen.findByRole("combobox", { name: "País" });
  expect(country).toBeEnabled();
  expect(country).toHaveAttribute("placeholder", "Elige un país");
  expect(country).toHaveValue("");
  expect(value()).toBeNull();
  expect(screen.queryByRole("button", { name: "Agregar ubicación" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Quitar ubicación" })).not.toBeInTheDocument();
  await select("País", "México");
  expect(await screen.findByLabelText("Código postal")).toBeVisible();
  expect(await screen.findByRole("combobox", { name: "Estado" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Quitar ubicación" })).not.toHaveClass("border-border", "bg-primary");
  await userEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
  expect(value()).toBeNull();
  expect(screen.getByRole("combobox", { name: "País" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Quitar ubicación" })).not.toBeInTheDocument();
});
const value = () => JSON.parse(screen.getByTestId("value").textContent!);
async function select(label: string, option: string) {
  const user = userEvent.setup();
  const input = screen.getByRole("combobox", { name: label });
  await user.clear(input); await user.type(input, option);
  await user.click(await screen.findByRole("option", { name: option }));
}
it("defaults to México, names controls and disables municipality until a state", async () => {
  const { container } = render(<Harness required={["country", "state"]} />);
  await waitFor(() => expect(value().country).toBe("MX"));
  expect(await screen.findByRole("combobox", { name: "País" })).toHaveValue("México");
  expect(await screen.findByRole("combobox", { name: "Estado" })).toHaveAttribute("aria-required", "true");
  expect(screen.getByRole("combobox", { name: "Municipio" })).toBeDisabled();
  expect(screen.getByLabelText("Código postal")).toHaveAttribute("inputmode", "numeric");
  expect(container.querySelector('[data-slot="field-set"] > [data-slot="field-legend"]')).toHaveTextContent("Ubicación");
});
it("preloads one postal match without locking fields", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "01000" } });
  await waitFor(() => expect(value()).toEqual({ country: "MX", state: "01", municipality: "01001", postal_code: "01000" }));
  expect(await screen.findByRole("combobox", { name: "Municipio" })).not.toBeDisabled();
});
it("offers several matches and applies only the chosen pair", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "02000" } });
  expect(await screen.findByText("Este código postal corresponde a varios municipios")).toBeInTheDocument();
  expect(value().municipality).toBeNull();
  await select("Municipio del código postal", "Asientos, Aguascalientes");
  expect(value().municipality).toBe("01002");
});
it("keeps the postal code when switching between its valid matches", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "02000" } });
  await screen.findByText("Este código postal corresponde a varios municipios");
  await select("Municipio del código postal", "Aguascalientes, Aguascalientes");
  await select("Municipio", "Asientos");
  expect(value().postal_code).toBe("02000");
});
it("shows postal not-found without locking manual selection or retrying", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "99999" } });
  expect(await screen.findByText("No encontramos ese código postal.")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Estado" })).not.toBeDisabled();
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("99999"))).toHaveLength(1);
});
it("clears municipality on state change and incompatible postal code with a note", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "03000" } });
  await waitFor(() => expect(value().municipality).toBe("01001"));
  await select("Estado", "Baja California");
  expect(value().municipality).toBeNull(); expect(value().postal_code).toBeNull();
  expect(screen.getByText("Quitamos el código postal porque no corresponde al municipio elegido.")).toBeInTheDocument();
});
it("clears an incompatible postal code on municipality change", async () => {
  render(<Harness />);
  fireEvent.change(await screen.findByLabelText("Código postal"), { target: { value: "04000" } });
  await waitFor(() => expect(value().municipality).toBe("01001"));
  await select("Municipio", "Asientos");
  expect(value().postal_code).toBeNull();
});
it("non-MX selection hides and clears subdivisions", async () => {
  render(<Harness initial={{ country: "MX", state: "01", municipality: "01001", postal_code: null }} />);
  await select("País", "Estados Unidos");
  expect(value()).toEqual({ country: "US", state: null, municipality: null, postal_code: null });
  expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();
  expect(screen.getByText("Por ahora solo detallamos ubicaciones en México.")).toBeInTheDocument();
});
it("shows catalog failure inline and only retries after a click", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ items: towns }));
  vi.stubGlobal("fetch", (url: string) => url.includes("/77/") ? request() : fetcher(url));
  const { rerender } = render(<Harness initial={{ ...empty, country: "MX", state: "77" }} />);
  expect(await screen.findByText("No pudimos cargar municipio.")).toBeInTheDocument();
  rerender(<Harness initial={{ ...empty, country: "MX", state: "77" }} />);
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(screen.queryByText("No pudimos cargar municipio.")).not.toBeInTheDocument());
  expect(request).toHaveBeenCalledTimes(2);
});
it("ignores a late postal response after a newer code and rejects non-digits", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  vi.stubGlobal("fetch", (url: string) => url.endsWith("05000") ? pending : url.endsWith("06000") ? Promise.resolve(Response.json({ postal_code: "06000", matches: [pair(1)] })) : fetcher(url));
  render(<Harness />);
  const input = await screen.findByLabelText("Código postal");
  fireEvent.change(input, { target: { value: "abcde" } });
  expect(value().postal_code).toBeNull();
  fireEvent.change(input, { target: { value: "05000" } });
  fireEvent.change(input, { target: { value: "06000" } });
  await waitFor(() => expect(value().municipality).toBe("01002"));
  await act(async () => { resolve(Response.json({ postal_code: "05000", matches: [pair()] })); });
  expect(value().postal_code).toBe("06000"); expect(value().municipality).toBe("01002");
});
it("honors depth, postal flag, disabled and field-level errors", async () => {
  const { rerender } = render(<Harness depth="country" postalCode={false} />);
  await screen.findByRole("combobox", { name: "País" });
  expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Código postal")).not.toBeInTheDocument();
  rerender(<Harness depth="state" postalCode={false} disabled errors={[{ field: "fields.location.state", reason: "required" }]} />);
  const state = await screen.findByRole("combobox", { name: "Estado" });
  expect(state).toBeDisabled(); expect(state).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Completa este dato.")).toHaveAttribute("data-slot", "field-error");
  expect(screen.queryByLabelText("Municipio")).not.toBeInTheDocument();
});
it("keeps the same field anatomy and responsive row while a catalog loads", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", (url: string) => url.includes("/88/") ? new Promise<Response>(done => { resolve = done; }) : fetcher(url));
  const { container } = render(<Harness initial={{ ...empty, country: "MX", state: "88" }} />);
  const anatomy = () => [...container.querySelectorAll('[data-slot^="field"]')].map(element => element.getAttribute("data-slot"));
  const before = anatomy();
  expect(screen.getByText("Cargando municipio")).toHaveAttribute("role", "status");
  expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute("aria-hidden", "true");
  await act(async () => { resolve(Response.json({ items: towns })); });
  expect(anatomy()).toEqual(before);
  expect(screen.getByRole("combobox", { name: "Municipio" })).not.toBeDisabled();
});

it("filters countries by name while MX is the defaulted selection", async () => {
  // User report: «en pais, no me aparece nada, sea lo que sea que escriba, me dice "sin coincidencias"».
  render(<Harness />);
  const input = await screen.findByRole("combobox", { name: "País" });
  await waitFor(() => expect(value().country).toBe("MX"));
  const user = userEvent.setup();
  await user.click(input); await user.clear(input); await user.type(input, "Esta");
  const option = await screen.findByRole("option", { name: "Estados Unidos" });
  expect(option).toBeVisible();
  // «Sin coincidencias.» is always mounted and only shown by CSS when its own list is empty, and
  // other comboboxes may keep theirs mounted: assert the country list itself is not empty.
  await waitFor(() => expect(option.closest('[data-slot="combobox-content"]')).not.toHaveAttribute("data-empty"));
});

it("replaces the shown selection when typing into a filled catalog field", async () => {
  render(<Harness />);
  const input = await screen.findByRole("combobox", { name: "País" });
  await waitFor(() => expect(input).toHaveValue("México"));
  const user = userEvent.setup();
  await user.click(input); await user.keyboard("Esta");
  expect(input).toHaveValue("Esta");
  expect(await screen.findByRole("option", { name: "Estados Unidos" })).toBeVisible();
});

it("lets the state/municipality columns shrink so narrow containers never scroll sideways", async () => {
  // User report: «hay un scroll horizontal dentro de la card … solo dentro del formulario».
  render(<Harness initial={{ country: "MX", state: null, municipality: null, postal_code: null }} />);
  const state = await screen.findByRole("combobox", { name: "Estado" });
  const grid = state.closest('[data-slot="field-group"]')!;
  expect(grid).toHaveClass("[&>*]:min-w-0");
});

it("never rewrites a saved location whose postal code already matches its state and municipality", async () => {
  // Opening a saved on-site vacancy showed «Cambios sin guardar» with no input (QA D8).
  const onChange = vi.fn();
  render(<LocationField depth="municipality" postalCode label="Ubicación" value={{ country: "MX", state: "01", municipality: "01001", postal_code: "01000" }} onChange={onChange} />);
  await screen.findByLabelText("Código postal");
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("01000"), expect.anything()));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(onChange).not.toHaveBeenCalled();
});
