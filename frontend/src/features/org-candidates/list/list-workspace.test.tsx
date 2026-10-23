import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("../actions", () => ({ listCandidatesAction: vi.fn() }));
vi.mock("../summary/summary-actions", () => ({ getCandidatesSummaryAction: async () => ({ ok: true, data: { total: 37, with_active_process: 20, added_last_7_days: 2, by_kind: { manual: 12, organic: 25 } } }) }));
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn().mockResolvedValue({ ok: true, items: [], nextCursor: null }) }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ states: { status: "success", data: { items: [] } } }), useGeoResource: () => ({ status: "success", data: { items: [] } }) }));
import { listCandidatesAction } from "../actions";
import { OrgCandidatesWorkspace } from "./list-workspace";
import { candidate, page } from "./test-fixtures";
import { detailFixture } from "../detail/test-fixtures";
beforeEach(() => {
 vi.resetAllMocks(); localStorage.clear();
 vi.stubGlobal("innerWidth", 1440);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 window.history.replaceState(null, "", "/empresa/talento"); vi.mocked(listCandidatesAction).mockResolvedValue({ ok: true, data: page });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["table", "cards"])("renders the same profile and vacancy facts in %s, with a real candidate action", async view => {
 window.history.replaceState(null, "", `/empresa/talento?view=${view}`); const open = vi.fn(); render(<OrgCandidatesWorkspace onOpenCandidate={open} />);
 await screen.findByText("Mariana Ortega Silva");
 expect(screen.getByText(/candidatos en tu base de talento/u).closest('[role="status"]')).toHaveTextContent('37 candidatos en tu base de talento');
 for (const fact of ["Desarrolladora Frontend", "Licenciatura o Ingeniería", "Inglés C1", "Backend Go"]) expect(screen.getByText(fact)).toBeTruthy();
 expect(screen.getByText(view === 'cards' ? 'Guadalajara, Jalisco' : 'Guadalajara')).toBeTruthy();
 if (view === "cards") {
   expect(screen.getByText("Manual")).toBeTruthy(); expect(screen.getByText("Maestría · En curso")).toBeTruthy();
   expect(document.body.textContent).toContain("Senior · 4.5 años");
   fireEvent.click(screen.getByRole("button", { name: "Abrir ficha de Mariana Ortega Silva" })); expect(screen.getByText("2 procesos")).toBeTruthy(); expect(screen.getByText('1 activo')).toBeTruthy();
 } else {
   expect(screen.getByText("Maestría · En curso")).toBeTruthy(); expect(screen.getByText("4.5 años")).toBeTruthy();
   fireEvent.click(screen.getByText(candidate.full_name).closest("tr")!);
 }
 expect(open).toHaveBeenCalledWith({ kind: "manual", id: candidate.id });
});
it.each([["paused", "active", "Pausada"], ["closed", "active", "Cerrada"], ["closed", "finished", "Proceso finalizado"]] as const)("shows %s/%s lifecycle and discarded state", async (publication, process, label) => {
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...candidate, latest_participation: { ...candidate.latest_participation, state: "discarded", vacancy: { ...candidate.latest_participation.vacancy, lifecycle: { publication, process } } } }] } });
 window.history.replaceState(null, "", "/empresa/talento?view=cards");
 render(<OrgCandidatesWorkspace />); expect(await screen.findByText(label)).toBeTruthy(); expect(screen.getByText("Descartado")).toBeTruthy();
});
it.each(["table", "cards"])("initial loading mirrors %s", async view => {
 window.history.replaceState(null, "", `/empresa/talento?view=${view}`); vi.mocked(listCandidatesAction).mockReturnValue(new Promise(() => {}));
 const { container } = render(<OrgCandidatesWorkspace />); expect(container.querySelector(`[data-candidates-skeleton='${view}']`)).toBeTruthy(); await act(async () => {});
});
it("distinguishes empty pool from no filtered results and clears URL filters", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: true, data: { items: [], total: 0, next_cursor: null } });
 const first = render(<OrgCandidatesWorkspace />); expect(await screen.findByText("Todavía no hay candidatos en tu organización")).toBeTruthy(); first.unmount();
 window.history.replaceState(null, "", "/empresa/talento?q=Nope"); render(<OrgCandidatesWorkspace />); expect(await screen.findByText("Sin resultados")).toBeTruthy();
 fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" })); await waitFor(() => expect(window.location.search).not.toContain("q="));
});
it.each(["unauthenticated", "forbidden", "invalid_filter"] as const)("shows a safe %s failure", async reason => {
 vi.mocked(listCandidatesAction).mockResolvedValue({ ok: false, reason, reference: {} });
 render(<OrgCandidatesWorkspace />);
 expect(await screen.findByText(reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo para consultar los candidatos." : reason === "forbidden" ? "Necesitas ser miembro de esta organización para consultar sus candidatos." : "No pudimos aplicar los filtros. Limpia los filtros para volver a consultar la lista.")).toBeTruthy();
 expect(screen.getByRole("button", { name: reason === "invalid_filter" ? "Limpiar filtros" : "Reintentar" })).toBeTruthy();
});
it("shows safe error and retries", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
 render(<OrgCandidatesWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Reintentar" })); expect(await screen.findByText(candidate.full_name)).toBeTruthy();
});
it("appends load-more results without replacing the first page", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: true, data: { ...page, items: [{ ...candidate, kind: "organic", full_name: "Ana Ríos" }] } });
 render(<OrgCandidatesWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Cargar más" })); await screen.findByText("Ana Ríos"); expect(screen.getByText(candidate.full_name)).toBeTruthy();
 expect(listCandidatesAction).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "opaque" }));
});
it("patches a saved candidate across accumulated pages without losing pagination or URL state", async () => {
 window.history.replaceState(null, "", "/empresa/talento?view=cards&origin=manual");
 const second = { ...candidate, id: detailFixture().id, full_name: "Nombre anterior" };
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: true, data: { ...page, items: [second], next_cursor: "next" } });
 const view = render(<OrgCandidatesWorkspace />);
 fireEvent.click(await screen.findByRole("button", { name: "Cargar más" })); await screen.findByText(second.full_name);
 const url = window.location.search;
 const updated = { ...detailFixture(), full_name: "Nombre actualizado", professional_title: "Ingeniera", profile: { ...detailFixture().profile, skills: ["Go"] } };
 view.rerender(<OrgCandidatesWorkspace updatedCandidate={updated} />);
 expect(await screen.findByText(updated.full_name)).toBeVisible();
 expect(screen.getByText(candidate.full_name)).toBeVisible();
 expect(screen.queryByText(second.full_name)).not.toBeInTheDocument();
 expect(screen.getByText("Ingeniera")).toBeVisible();
 expect(screen.getByRole("button", { name: "Cargar más" })).toBeEnabled();
 expect(window.location.search).toBe(url);
 expect(listCandidatesAction).toHaveBeenCalledTimes(2);
});
it("does not let an in-flight page overwrite a confirmed row edit", async () => {
 let finish!: (value: Awaited<ReturnType<typeof listCandidatesAction>>) => void;
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const view = render(<OrgCandidatesWorkspace />);
 fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
 const updated = { ...detailFixture(), id: candidate.id, full_name: "Nombre actualizado" };
 view.rerender(<OrgCandidatesWorkspace updatedCandidate={updated} />);
 await screen.findByText(updated.full_name);
 await act(async () => finish({ ok: true, data: { ...page, items: [candidate, { ...candidate, kind: "organic" }] } }));
 expect(screen.getByText(updated.full_name)).toBeVisible();
 // The same UUID in a different kind is a different row, not another patch target.
 expect(screen.getByText(candidate.full_name)).toBeVisible();
});
it("drops invalid vacancy from URL with explicit copy", async () => {
 window.history.replaceState(null, "", "/empresa/talento?vacancy=gone&q=Ana"); vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: false, reason: "invalid_filter", fields: [{ field: "vacancy", code: "not_found" }], reference: {} });
 render(<OrgCandidatesWorkspace />); expect(await screen.findByText("Esa vacante ya no está disponible")).toBeTruthy(); await waitFor(() => expect(window.location.search).not.toContain("vacancy=")); expect(window.location.search).toContain("q=Ana");
});
it("restarts first page on invalid load-more cursor", async () => {
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "expired" } }).mockResolvedValueOnce({ ok: false, reason: "invalid_cursor", reference: {} }).mockResolvedValueOnce({ ok: true, data: page });
 render(<OrgCandidatesWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Cargar más" })); await waitFor(() => expect(listCandidatesAction).toHaveBeenCalledTimes(3));
 expect(listCandidatesAction).toHaveBeenLastCalledWith({ filters: {} }); expect(await screen.findByText(candidate.full_name)).toBeTruthy();
});
it("view switching preserves query and loaded results without fetching again", async () => {
 window.history.replaceState(null, "", "/empresa/talento?q=Mariana&seniority=senior"); render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole("button", { name: "Tarjetas" })); expect(window.location.search).toContain("q=Mariana"); expect(window.location.search).toContain("seniority=senior"); expect(window.location.search).toContain("view=cards"); expect(listCandidatesAction).toHaveBeenCalledTimes(1);
});
it.each(["table", "cards"])("opens %s candidates with the keyboard", async view => {
 window.history.replaceState(null, "", `/empresa/talento?view=${view}`); const open = vi.fn(); const user = userEvent.setup();
 render(<OrgCandidatesWorkspace onOpenCandidate={open} />);
 const name = await screen.findByText(candidate.full_name);
 const action = view === "cards" ? screen.getByRole("button", { name: "Abrir ficha de Mariana Ortega Silva" }) : name.closest("tr")!; action.focus(); await user.keyboard("{Enter}");
 expect(open).toHaveBeenCalledWith({ kind: "manual", id: candidate.id });
});
it("removing an active filter resets the URL cursor and requests page one", async () => {
 window.history.replaceState(null, "", "/empresa/talento?origin=manual&cursor=opaque&view=cards"); render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 fireEvent.click(screen.getByRole("button", { name: "Quitar filtro Origen: Manual" }));
 await waitFor(() => expect(listCandidatesAction).toHaveBeenLastCalledWith({ filters: {} }));
 expect(window.location.search).toBe("?view=cards");
});
it("shows a spinner and disables duplicate load-more requests while pending", async () => {
 let finish!: (value: Awaited<ReturnType<typeof listCandidatesAction>>) => void;
 vi.mocked(listCandidatesAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const { container } = render(<OrgCandidatesWorkspace />); const more = await screen.findByRole("button", { name: "Cargar más" }); fireEvent.click(more);
 await waitFor(() => expect(more.hasAttribute("disabled")).toBe(true)); expect(container.querySelector("[data-slot=spinner]")).toBeTruthy(); expect(screen.getByText(candidate.full_name)).toBeTruthy();
 await act(async () => { finish({ ok: true, data: page }); }); expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
});
it("ignores an obsolete request after filters change", async () => {
 let finish!: (value: Awaited<ReturnType<typeof listCandidatesAction>>) => void;
 vi.mocked(listCandidatesAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ ok: true, data: { ...page, items: [{ ...candidate, full_name: "Ana Ríos" }] } });
 render(<OrgCandidatesWorkspace />); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ana" } });
 await screen.findByText("Ana Ríos"); await act(async () => { finish({ ok: true, data: page }); });
 expect(screen.queryByText(candidate.full_name)).toBeNull(); expect(screen.getByText("Ana Ríos")).toBeTruthy();
});
it("provides a compact outline toggle with a distinct pressed state in the toolbar", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 const table = screen.getByRole("button", { name: "Tabla" });
 const cards = screen.getByRole("button", { name: "Tarjetas" });
 expect(table.closest('[data-slot="toggle-group"]')).toHaveAttribute("data-size", "sm");
 expect(table.closest('[data-slot="toggle-group"]')).toHaveAttribute("data-variant", "outline");
 expect(table).toHaveAttribute("aria-pressed", "true");
 expect(cards).toHaveAttribute("aria-pressed", "false");
 expect(table).toHaveClass("aria-pressed:bg-secondary", "aria-pressed:text-secondary-foreground", "aria-pressed:border-foreground/30");
 fireEvent.click(cards);
 expect(cards).toHaveAttribute("aria-pressed", "true");
 expect(table).toHaveAttribute("aria-pressed", "false");
});
it("groups search, filters and view in one desktop toolbar and puts the count above results", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 const search = screen.getByRole("searchbox");
 const filters = screen.getByRole("button", { name: "Filtros" });
 const toggle = screen.getByRole("button", { name: "Tabla" });
 const row = search.closest('[data-candidates-toolbar]');
 expect(row).toContainElement(filters); expect(row).toContainElement(toggle);
 expect(row).toContainElement(screen.getByRole("button", { name: "Columnas" }));
 expect(row).toContainElement(screen.getByRole("button", { name: "Restablecer vista" }));
 expect(row).toHaveClass("md:flex-nowrap");
 expect(search.closest('[data-slot="field"]')).toHaveClass("w-full", "md:flex-1");
 expect(within(screen.getByRole("region", { name: "Resultados de candidatos" })).getByText(/candidatos en tu base de talento/u)).toHaveTextContent('37 candidatos en tu base de talento');
});
it.each(["table", "cards"])("forces mobile cards without rewriting the %s URL preference or filters", async view => {
 vi.stubGlobal("innerWidth", 390);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 const query = `?view=${view}&q=Mariana&seniority=senior`;
 window.history.replaceState(null, "", `/empresa/talento${query}`);
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name);
 expect(screen.queryByRole("table")).not.toBeInTheDocument();
 expect(screen.getByLabelText("Tarjetas de candidatos")).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Tabla" }).closest('[data-slot="toggle-group"]')).toHaveClass("hidden", "md:flex");
 expect(window.location.search).toBe(query);
 expect(listCandidatesAction).toHaveBeenCalledTimes(1);
});
it("keeps mobile keyboard activation and restores the saved table on desktop without fetching", async () => {
 let resize: (() => void) | undefined;
 vi.stubGlobal("innerWidth", 390);
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, media: "", addEventListener: (_: string, listener: () => void) => { resize = listener; }, removeEventListener: vi.fn() })));
 window.history.replaceState(null, "", "/empresa/talento?view=table&q=Mariana");
 const open = vi.fn(); const user = userEvent.setup();
 render(<OrgCandidatesWorkspace onOpenCandidate={open} />);
 const name = await screen.findByRole("button", { name: `Abrir ficha de ${candidate.full_name}` });
 name.focus(); await user.keyboard("{Enter}");
 expect(open).toHaveBeenCalledWith({ kind: candidate.kind, id: candidate.id });
 expect(screen.queryByRole("table")).not.toBeInTheDocument();
 act(() => { vi.stubGlobal("innerWidth", 1440); resize?.(); });
 expect(screen.getByRole("table")).toBeInTheDocument();
 expect(window.location.search).toBe("?view=table&q=Mariana");
 expect(listCandidatesAction).toHaveBeenCalledTimes(1);
});
it("uses cards for the mobile loading state while retaining the table preference", async () => {
 vi.stubGlobal("innerWidth", 390);
 vi.mocked(listCandidatesAction).mockReturnValue(new Promise(() => {}));
 window.history.replaceState(null, "", "/empresa/talento?view=table");
 const { container } = render(<OrgCandidatesWorkspace />);
 expect(container.querySelector('[data-candidates-skeleton="cards"]')).toBeTruthy();
 expect(container.querySelector("table")).toBeNull();
 expect(window.location.search).toBe("?view=table");
 await act(async () => {});
});
it("debounces search and resets pagination", async () => {
 render(<OrgCandidatesWorkspace />); await screen.findByText(candidate.full_name); vi.useFakeTimers();
 fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ana" } }); expect(listCandidatesAction).toHaveBeenCalledTimes(1);
 await act(async () => { await vi.advanceTimersByTimeAsync(350); }); vi.useRealTimers();
 await waitFor(() => expect(window.location.search).toContain("q=Ana")); expect(listCandidatesAction).toHaveBeenLastCalledWith({ filters: { q: "Ana" } });
});
