import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JobsNavigationIsland } from "./JobsNavigationIsland";
// Keep real selection semantics; jsdom cannot position anchored portals reliably.
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: React.ReactNode }) => <div data-slot="combobox-content">{children}</div>,
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../../geo/use-geo-catalog", () => ({
  useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }, { id: "US", name: "Estados Unidos" }] } }, states: { status: "success", data: { items: [{ id: "09", name: "Ciudad de México" }, { id: "14", name: "Jalisco" }] } } }),
  useGeoResource: (key: string) => ({ status: "success", data: key.includes("/09/") ? mx : jal }),
}));
const mx = { items: [{ id: "09002", name: "Azcapotzalco" }] };
const jal = { items: [{ id: "14039", name: "Guadalajara" }] };
afterEach(() => { cleanup(); push.mockReset(); });
it("disables municipality until states are selected and provides a single country control", () => {
  render(<JobsNavigationIsland routeKey="/vacantes" query={{}}><p>Results</p></JobsNavigationIsland>);
  expect(screen.getByLabelText("Municipio").hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Elige uno o más estados primero.")).toBeTruthy();
  expect(screen.getAllByRole("combobox", { name: "Postulo desde" })).toHaveLength(1);
  expect(screen.queryByLabelText("Ubicación")).toBeNull();
});
it("uses names in removable chips and removes a state's municipalities, dropping cursor", async () => {
  render(<JobsNavigationIsland routeKey="/vacantes?state=09&state=14&municipality=09002&municipality=14039&cursor=old" query={{ state: ["09", "14"], municipality: ["09002", "14039"], applicant_country: "MX" }}><p>Results</p></JobsNavigationIsland>);
  expect(await screen.findByRole("button", { name: "Quitar filtro Municipio: Azcapotzalco" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Quitar filtro Postulo desde: México" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Quitar filtro Estado: Ciudad de México" }));
  expect(push).toHaveBeenCalledWith("/vacantes?state=14&municipality=14039");
});
it("loads municipality options only for selected states", async () => {
  render(<JobsNavigationIsland routeKey="/vacantes?state=09" query={{ state: ["09"] }}><p>Results</p></JobsNavigationIsland>);
  fireEvent.click(screen.getByLabelText("Municipio"));
  await waitFor(() => expect(screen.getByRole("option", { name: "Azcapotzalco" })).toBeTruthy());
  expect(screen.queryByRole("option", { name: "Guadalajara" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "Jalisco" }));
  expect(await screen.findByRole("option", { name: "Guadalajara" })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "Azcapotzalco" }));
  fireEvent.click(screen.getByRole("option", { name: "Guadalajara" }));
  fireEvent.click(screen.getByRole("option", { name: "Ciudad de México" }));
  fireEvent.submit(screen.getByRole("form", { name: "Filtros" }));
  expect(push).toHaveBeenLastCalledWith("/vacantes?state=14&municipality=14039");
});
it("commits multiple modes but only one applicant country", () => {
  render(<JobsNavigationIsland routeKey="/vacantes?cursor=old" query={{}}><p>Results</p></JobsNavigationIsland>);
  fireEvent.click(screen.getByRole("option", { name: "Remoto" }));
  fireEvent.click(screen.getByRole("option", { name: "Híbrido" }));
  fireEvent.click(screen.getByRole("option", { name: "México" }));
  fireEvent.click(screen.getByRole("option", { name: "Estados Unidos" }));
  fireEvent.submit(screen.getByRole("form", { name: "Filtros" }));
  expect(push).toHaveBeenCalledWith("/vacantes?work_mode=remote&work_mode=hybrid&applicant_country=US");
});
