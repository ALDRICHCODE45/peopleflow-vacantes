import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Retain real Combobox selection/keyboard behavior; jsdom has no popup positioning
// geometry. Shared primitive/browser tests own positioning (the board uses this boundary too).
vi.mock("@/components/ui/combobox", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/ui/combobox")>();
 return { ...actual, ComboboxContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
vi.mock("@/components/ui/select", async () => {
 const React = await import("react");
 const Context = React.createContext({ value: "", items: [] as { value: string; label: string }[], change: (value: string) => { void value; } });
 return {
  Select: ({ value, items, onValueChange, children }: { value: string; items: { value: string; label: string }[]; onValueChange: (value: string) => void; children: React.ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
  SelectTrigger: (props: React.ComponentProps<"select">) => { const state = React.useContext(Context); return <select {...props} value={state.value} onChange={event => state.change(event.target.value)}>{state.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>; },
  SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
 };
});
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoResource: (key: string) => ({ status: "success", data: { items: key.endsWith("municipalities") ? [{ id: "14039", name: "Guadalajara" }] : [{ id: "14", name: "Jalisco" }] }, retry: vi.fn() }) }));
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import { CandidateFiltersBar } from "./candidate-filters";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
const languages = [{ code: "en", name: "Inglés" }];
beforeEach(() => {
 vi.resetAllMocks(); vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [], nextCursor: null });
 vi.stubGlobal("PointerEvent", MouseEvent);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("reads all vacancy pages and the geo/language catalogs, not facets of loaded candidates", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: true, items: [{ id: "a", title: "Backend Go" }] as DraftListRow[], nextCursor: "second" }).mockResolvedValueOnce({ ok: true, items: [{ id: "b", title: "Frontend React" }] as DraftListRow[], nextCursor: null });
 const change = vi.fn(); const user = userEvent.setup(); render(<CandidateFiltersBar filters={{ state: ["14"] }} onChange={change} onClear={vi.fn()} languages={languages} />);
 await user.click(screen.getByRole("button", { name: /^Filtros/ }));
 expect(listDraftsAction).toHaveBeenLastCalledWith({ limit: 50, cursor: "second" });
 const dialog = screen.getByRole("region", { name: "Filtrar candidatos" }); expect(within(dialog).getByRole("combobox", { name: "Municipio · Jalisco" })).toBeTruthy();
 await user.click(within(dialog).getByRole("combobox", { name: "Vacante" }));
 await user.click(await screen.findByRole("option", { name: "Frontend React" })); expect(change).toHaveBeenLastCalledWith({ vacancy: ["b"] });
});
it("offers a single minimum education and selected-language minimum, with board copy", async () => {
 const user = userEvent.setup(); const change = vi.fn(); render(<CandidateFiltersBar filters={{ language: ["en"], education_level: "bachelor" }} onChange={change} onClear={vi.fn()} languages={languages} />);
 await user.click(screen.getByRole("button", { name: /^Filtros/ })); const dialog = screen.getByRole("region", { name: "Filtrar candidatos" });
 expect(within(dialog).getByRole("combobox", { name: "Nivel mínimo" })).toBeTruthy();
 expect(within(dialog).getByText("Coincide con este nivel o uno superior.")).toBeTruthy();
 await user.click(within(dialog).getByRole("checkbox", { name: "Incluye estudios en curso" })); expect(change).toHaveBeenLastCalledWith({ education_in_progress: "true" });
 fireEvent.change(within(dialog).getByRole("combobox", { name: "Nivel de estudios" }), { target: { value: "master" } }); expect(change).toHaveBeenLastCalledWith({ education_level: "master" });
});
it("hides dependent controls without their parent filters and retries a failed vacancy catalog", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
 const user = userEvent.setup(); render(<CandidateFiltersBar filters={{}} onChange={vi.fn()} onClear={vi.fn()} languages={languages} />);
 await user.click(screen.getByRole("button", { name: /^Filtros/ })); const dialog = screen.getByRole("region", { name: "Filtrar candidatos" });
 expect(within(dialog).queryByRole("combobox", { name: "Nivel mínimo" })).toBeNull(); expect(within(dialog).queryByRole("checkbox", { name: "Incluye estudios en curso" })).toBeNull();
 await user.click(await screen.findByRole("button", { name: "Reintentar vacantes" })); await waitFor(() => expect(listDraftsAction).toHaveBeenCalledTimes(2)); await act(async () => {});
});
it("labels the municipality filter group like its sibling filters before a state is chosen", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [], nextCursor: null });
 const user = userEvent.setup(); render(<CandidateFiltersBar filters={{}} onChange={vi.fn()} onClear={vi.fn()} languages={languages} />);
 await user.click(screen.getByRole("button", { name: /^Filtros/ }));
 const group = within(screen.getByRole("region", { name: "Filtrar candidatos" })).getByRole("group", { name: "Municipio" });
 expect(group.textContent).toContain("Elige un estado para buscar municipios.");
 expect(within(group).getByRole("checkbox", { name: "Sin dato de municipio" })).toBeTruthy();
 await act(async () => {});
});
