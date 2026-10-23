import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { detailFixture } from "../detail/test-fixtures";
vi.mock("../actions", () => ({ listCandidatesAction: vi.fn() }));
vi.mock("../contacts/contacts-actions", () => ({ getCandidateContactsAction: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }) }));
vi.mock("../summary/summary-actions", () => ({ getCandidatesSummaryAction: async () => ({ ok: true, data: { total: 37, with_active_process: 20, added_last_7_days: 2, by_kind: { manual: 12, organic: 25 } } }) }));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }) }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoResource: () => ({ status: "success", data: { items: [] } }) }));
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
import { listCandidatesAction } from "../actions";
import { getCandidateContactsAction } from "../contacts/contacts-actions";
import { OrgCandidatesWorkspace } from "./list-workspace";
import { candidate, page } from "./test-fixtures";
const second = { ...candidate, kind: "organic" as const, full_name: 'Ana, "López"' };
beforeEach(() => {
 vi.mocked(getCandidateContactsAction).mockResolvedValue({ ok: true, data: { items: [] } });
 localStorage.clear(); window.history.replaceState(null, "", "/empresa/talento");
 vi.stubGlobal("innerWidth", 1440); vi.stubGlobal("PointerEvent", MouseEvent);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: true, data: { ...page, items: [candidate, second] } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([{ metaKey: true }, { ctrlKey: true }])("focuses search with the platform shortcut %j and includes a hint", async modifier => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 const search = screen.getByRole("searchbox", { name: "Buscar candidatos" });
 fireEvent.keyDown(document, { key: "k", ...modifier }); expect(search).toHaveFocus();
 expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
 expect(search.closest('[data-slot="input-group"]')?.querySelector("kbd")).toHaveTextContent(/K/u);
});
it("toggles filters inline and keeps toolbar, count and results in one surface", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 const filters = screen.getByRole("button", { name: "Filtros" });
 expect(filters).toHaveAttribute("aria-expanded", "false");
 fireEvent.click(filters);
 const panel = screen.getByRole("region", { name: "Filtrar candidatos" });
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(panel).toContainElement(screen.getByLabelText("Origen"));
 expect(filters).toHaveAttribute("aria-controls", panel.id);
 expect(filters.closest('[data-slot="card"]')).toContainElement(screen.getByRole("table"));
 expect(screen.getByText(/candidatos en tu base de talento/u).closest('[role="status"]')).toHaveTextContent("37 candidatos en tu base de talento");
 expect(screen.getByText("Actualizado hace un momento")).toBeInTheDocument();
 fireEvent.click(filters); expect(screen.queryByRole("region", { name: "Filtrar candidatos" })).not.toBeInTheDocument();
});
it("updates relative time from the successful load, not candidate activity", async () => {
 vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
 vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T18:00:00Z"));
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 expect(screen.getByText("Actualizado hace un momento")).toBeInTheDocument();
 vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-23T18:02:00Z"));
 await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
 expect(screen.getByText("Actualizado hace 2 minutos")).toBeInTheDocument();
});
it("selects individual/all loaded rows, shows mixed state and never opens the sheet", async () => {
 const open = vi.fn(); render(<OrgCandidatesWorkspace onOpenCandidate={open} />); await screen.findByText(candidate.full_name);
 const all = screen.getByRole("checkbox", { name: "Seleccionar todos" });
 const row = screen.getByRole("checkbox", { name: `Seleccionar a ${candidate.full_name}` });
 fireEvent.click(row); expect(all).toHaveAttribute("aria-checked", "mixed");
 // Mixed reads as a dash, never as the fully-checked tick.
 expect(all.parentElement!.querySelector("svg.lucide-minus")).not.toBeNull();
 for (const tick of all.querySelectorAll("svg.lucide-check")) expect(tick.closest("[data-slot=checkbox]")).toHaveAttribute("data-mixed");
 expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
 fireEvent.keyDown(row, { key: "Enter" }); expect(open).not.toHaveBeenCalled();
 fireEvent.click(all); expect(all).toHaveAttribute("aria-checked", "true");
 expect(screen.getByText("2 seleccionados")).toBeInTheDocument(); expect(open).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Limpiar selección" }));
 expect(all).toHaveAttribute("aria-checked", "false"); expect(screen.queryByText("2 seleccionados")).not.toBeInTheDocument();
});
it.each(["search", "filter", "back"])("clears selection when %s changes", async change => {
 window.history.replaceState(null, "", "/empresa/talento?origin=manual");
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos" }));
 expect(screen.getByRole("button", { name: "Exportar seleccionados" })).toBeInTheDocument();
 if (change === "search") fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ana" } });
 else if (change === "filter") fireEvent.click(screen.getByRole("button", { name: "Quitar filtro Origen: Manual" }));
 else act(() => { window.history.replaceState(null, "", "/empresa/talento?origin=organic"); window.dispatchEvent(new Event("popstate")); });
 await waitFor(() => expect(screen.queryByRole("button", { name: "Exportar seleccionados" })).not.toBeInTheDocument());
});
it("exports only selected rows and visible columns as BOM CSV with escaping and dated filename", async () => {
 const blobs: Blob[] = []; vi.stubGlobal("URL", class extends URL {
  static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:csv"; }); static revokeObjectURL = vi.fn();
 });
 const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole("button", { name: "Columnas" }));
 const menu = screen.getByRole("menu"); expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(7);
 fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Ubicación" }));
 expect(screen.queryByRole("columnheader", { name: "Ubicación" })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar a ${second.full_name}` }));
 fireEvent.click(screen.getByRole("button", { name: "Exportar seleccionados" }));
 await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
 const anchor = clicked.mock.contexts[0] as unknown as HTMLAnchorElement; const now = new Date();
 expect(anchor.download).toBe(`candidatos-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`);
 expect(anchor.href).toBe("blob:csv");
 const reader = new FileReader(); let bytes!: ArrayBuffer;
 await act(async () => { bytes = await new Promise<ArrayBuffer>(resolve => { reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blobs[0]); }); });
 expect([...new Uint8Array(bytes).slice(0, 3)]).toEqual([239, 187, 191]);
 const csv = new TextDecoder().decode(bytes); expect(csv).toContain('Ana, ""López""'); expect(csv).not.toContain(candidate.full_name);
 expect(csv).not.toContain("Ubicación"); expect(csv).not.toContain("Acciones"); expect(csv).not.toContain("Seleccionar"); expect(csv).not.toContain("<");
});
it("sorts candidates from the header without losing row selection", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar a ${candidate.full_name}` }));
 fireEvent.click(screen.getByRole("button", { name: "Ordenar por candidato" }));
 expect(screen.getByRole("columnheader", { name: "Candidato" })).toHaveAttribute("aria-sort", "ascending");
 expect(screen.getAllByRole("row")[1]).toHaveTextContent(second.full_name);
 expect(screen.getByRole("checkbox", { name: `Seleccionar a ${candidate.full_name}` })).toHaveAttribute("aria-checked", "true");
});
it("keeps selection and export available in cards and at 390px", async () => {
 vi.stubGlobal("innerWidth", 390); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 const open = vi.fn(); render(<OrgCandidatesWorkspace onOpenCandidate={open} />); await screen.findByText(candidate.full_name);
 expect(screen.queryByRole("table")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar a ${candidate.full_name}` }));
 expect(screen.getByRole("button", { name: "Exportar seleccionados" })).toBeInTheDocument(); expect(open).not.toHaveBeenCalled();
 expect(screen.getByRole("button", { name: "Columnas" })).toBeInTheDocument();
});
it("keeps the selected checkbox mounted and focused for keyboard toggling", async () => {
 const open = vi.fn(); const user = userEvent.setup(); render(<OrgCandidatesWorkspace onOpenCandidate={open} />); await screen.findByText(candidate.full_name);
 const checkbox = screen.getByRole('checkbox', { name: `Seleccionar a ${candidate.full_name}` });
 await user.click(checkbox); expect(checkbox).toHaveFocus(); expect(checkbox).toHaveAttribute('aria-checked', 'true');
 await user.keyboard(' '); expect(checkbox).toHaveFocus(); expect(checkbox).toHaveAttribute('aria-checked', 'false'); expect(open).not.toHaveBeenCalled();
});
it("select-all covers only accumulated loaded pages and becomes mixed when another page arrives", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: 'next' } }).mockResolvedValueOnce({ ok: true, data: { ...page, items: [second] } });
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' })); expect(screen.getByText('1 seleccionado')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Cargar más' })); await screen.findByText(second.full_name);
 expect(screen.getByRole('checkbox', { name: 'Seleccionar todos' })).toHaveAttribute('aria-checked', 'mixed');
 fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' })); expect(screen.getByText('2 seleccionados')).toBeInTheDocument();
 expect(screen.queryByText('37 seleccionados')).not.toBeInTheDocument();
});
it("preserves selection and column preferences when switching presentations", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole('checkbox', { name: `Seleccionar a ${candidate.full_name}` }));
 fireEvent.click(screen.getByRole('button', { name: 'Tarjetas' }));
 expect(screen.getByRole('checkbox', { name: `Seleccionar a ${candidate.full_name}` })).toHaveAttribute('aria-checked', 'true');
 expect(screen.getByText('1 seleccionado')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Columnas' }));
 fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ubicación' }));
 fireEvent.click(screen.getByRole('button', { name: 'Tabla' }));
 expect(screen.queryByRole('columnheader', { name: 'Ubicación' })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Restablecer vista' }));
 expect(screen.getByRole('columnheader', { name: 'Ubicación' })).toBeInTheDocument();
 expect(screen.getByText('1 seleccionado')).toBeInTheDocument();
});
it("does not announce a successful update on initial failure", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: false, reason: 'server_error', reference: {} });
 render(<OrgCandidatesWorkspace />); await screen.findByRole('button', { name: 'Reintentar' });
 expect(screen.queryByText(/Actualizado/u)).not.toBeInTheDocument();
});
it("keeps the successful timestamp after a failed load-more", async () => {
 const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-23T18:00:00Z'));
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: 'next' } }).mockResolvedValueOnce({ ok: false, reason: 'server_error', reference: {} });
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 now.mockReturnValue(Date.parse('2026-10-23T18:02:00Z'));
 fireEvent.click(screen.getByRole('button', { name: 'Cargar más' })); await screen.findByRole('button', { name: 'Reintentar' });
 expect(screen.getByText('Actualizado hace 2 minutos')).toBeInTheDocument(); expect(screen.getByText(candidate.full_name)).toBeInTheDocument();
});
it("shows a correction indicator from a confirmed sheet edit without extra reads", async () => {
 const view = render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 expect(screen.queryByLabelText('Datos corregidos por tu empresa')).not.toBeInTheDocument();
 const detail = { ...detailFixture(), id: candidate.id, corrected_fields: ['full_name' as const] };
 view.rerender(<OrgCandidatesWorkspace updatedCandidate={detail} />);
 await waitFor(() => expect(screen.getByLabelText('Datos corregidos por tu empresa')).toBeInTheDocument()); expect(listCandidatesAction).toHaveBeenCalledTimes(1);
});
