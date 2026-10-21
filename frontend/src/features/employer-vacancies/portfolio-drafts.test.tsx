import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import "@testing-library/jest-dom/vitest";
import { listDraftsAction, type DraftListActionResult } from "@/features/jobs/drafts/list/actions";
import { VacancyPortfolio } from "./vacancy-portfolio";
import { usePortfolioDrafts } from "./use-portfolio-drafts";
import { portfolioRowActions } from "./model";
import { NEXO_VACANCIES } from "./prototype-vacancies";
import { notifyActionResult } from "@/components/feedback/notify";
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const candidates = { total: 4, in_process: 2, discarded: 1, by_stage: [{ id, kind: "custom" as const, name: "Prueba técnica", count: 2 }, { id: "223e4567-e89b-42d3-a456-426614174000", kind: "new" as const, name: "Nuevos", count: 1 }, { id: "323e4567-e89b-42d3-a456-426614174000", kind: "screening" as const, name: "Revisión", count: 0 }] };
const row = { candidates: null, paused_at: null, closed_at: null, process_finished_at: null, id, status: "draft" as const, process: null, published_at: null, title: "Diseñador de producto", work_mode: "remote" as const, work_schedule: "full_time" as const, requester: { kind: "client" as const, id, name: "Acme" }, principal_recruiter: { id, name: "Ana" }, version: "1", created_at: "2026-10-14T12:00:00Z", updated_at: "2026-10-15T12:00:00Z" };
const unnamed = { ...row, id: "223e4567-e89b-42d3-a456-426614174000", title: null, work_mode: null, work_schedule: null, requester: null, principal_recruiter: { id, name: null }, updated_at: "2026-10-16T12:00:00Z" };
beforeEach(() => {
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
 vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
 vi.resetAllMocks(); vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row, unnamed], nextCursor: null }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderPortfolio = () => render(<VacancyPortfolio vacancies={NEXO_VACANCIES} />);
it("published private rows leave draft counts and enter active counts with real publication metadata", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row, { ...unnamed, candidates, status: "published", process: "active", published_at: "2026-10-16T12:00:00Z" }], nextCursor: null });
 const { container } = renderPortfolio(); await screen.findByText(row.title);
 expect(screen.getByRole("tab", { name: "Borradores 1" })).toBeVisible();
 expect(screen.getByRole("tab", { name: "Activas 4" })).toBeVisible();
 const active = container.querySelector(`[data-pf-vacancy-row="${unnamed.id}"]`) as HTMLElement;
 expect(active).toHaveTextContent("Activa"); expect(active).toHaveTextContent("Publicada el 16 de octubre de 2026");
 expect(active.querySelector('[data-slot="badge"]')).toHaveAttribute("data-variant", "accent");
 expect(within(active).getByRole("button", { name: "Acciones de Sin título" })).toBeVisible();
 fireEvent.click(screen.getByRole("tab", { name: "Borradores 1" })); expect(screen.queryByText("Sin título")).not.toBeInTheDocument();
});
it.each([
 ["draft", null, "Borrador", "Borradores"], ["published", "active", "Activa", "Activas"],
 ["paused", "active", "Pausada", "Pausadas"], ["closed", "active", "Cerrada · proceso en curso", "Cerradas"],
 ["closed", "finished", "Cerrada · proceso finalizado", "Cerradas"],
] as const)("maps real %s/%s badge and filter", async (status, process, label, filter) => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [{ ...row, candidates: status === "draft" ? null : candidates, status, process }], nextCursor: null });
 render(<VacancyPortfolio vacancies={[]} />); await screen.findByText(row.title);
 expect(screen.getByText(label)).toBeVisible();
 expect(screen.queryByText("Sin candidatos todavía")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("tab", { name: `${filter} 1` })); expect(screen.getByText(row.title)).toBeVisible();
});
it.each([
 ["published", "active", "Publicada el 16"],
 ["paused", "active", "Pausada el 17"],
 ["closed", "active", "Cerrada el 18"],
 ["closed", "finished", "Proceso finalizado el 19"],
] as const)("uses state-specific dates and live counts for %s/%s", async (status, process, date) => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [{ ...row, status, process, candidates, published_at: "2026-10-16T12:00:00Z", paused_at: "2026-10-17T12:00:00Z", closed_at: "2026-10-18T12:00:00Z", process_finished_at: "2026-10-19T12:00:00Z" }], nextCursor: null });
 render(<VacancyPortfolio vacancies={[]} />);
 await screen.findByText(row.title);
 expect(screen.getByText(`${date} de octubre de 2026`)).toBeVisible();
 expect(screen.getByText("4 candidatos · 2 en proceso")).toBeVisible();
 expect(screen.getByText("Prueba técnica: 2 · Nuevos: 1 · Revisión: 0 · Descartados: 1")).toBeVisible();
 expect(screen.queryByText("Sin candidatos todavía")).not.toBeInTheDocument();
});
it("shows the empty candidate message only for a zero total", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [{ ...row, status: "published", process: "active", candidates: { total: 0, in_process: 0, discarded: 0, by_stage: [] } }], nextCursor: null });
 render(<VacancyPortfolio vacancies={[]} />);
 expect(await screen.findByText("Sin candidatos todavía")).toBeVisible();
});
it("does not mistake discarded-only candidates for an empty pipeline or use an old publication date", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [{ ...row, status: "paused", process: "active", published_at: "2026-10-16T12:00:00Z", candidates: { ...candidates, total: 2, in_process: 0, discarded: 2, by_stage: candidates.by_stage.map(stage => ({ ...stage, count: 0 })) } }], nextCursor: null });
 render(<VacancyPortfolio vacancies={[]} />);
 await screen.findByText(row.title);
 expect(screen.getByText("2 candidatos · 0 en proceso")).toBeVisible();
 expect(screen.getByText("Prueba técnica: 0 · Nuevos: 0 · Revisión: 0 · Descartados: 2")).toBeVisible();
 expect(screen.queryByText("Sin candidatos todavía")).not.toBeInTheDocument();
 expect(screen.getByText("Fecha no disponible")).toBeVisible();
 expect(screen.queryByText(/Publicada el/)).not.toBeInTheDocument();
});
it("copies transition timestamps in place without losing candidate counts", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [{ ...row, candidates, status: "published", process: "active" }], nextCursor: null });
 const { result } = renderHook(() => usePortfolioDrafts());
 await waitFor(() => expect(result.current.pending).toBe(false));
 const view = { publication: "closed" as const, process: "finished" as const, version: "5", allowed_actions: [], published_at: "2026-10-16T12:00:00Z", paused_at: "2026-10-17T12:00:00Z", closed_at: "2026-10-18T12:00:00Z", process_finished_at: "2026-10-19T12:00:00Z" };
 act(() => result.current.lifecycleChanged(id, view));
 expect(result.current.items[0]).toMatchObject({ status: "closed", process: "finished", candidates, paused_at: view.paused_at, closed_at: view.closed_at, process_finished_at: view.process_finished_at });
 act(() => result.current.lifecycleChanged(id, { ...view, publication: "published", process: "active", published_at: "2026-10-20T12:00:00Z" }));
 expect(result.current.items[0]).toMatchObject({ status: "published", published_at: "2026-10-20T12:00:00Z", closed_at: view.closed_at, candidates });
 expect(listDraftsAction).toHaveBeenCalledTimes(1);
});
it("composes honest draft rows before prototypes, newest first, with both real actions", async () => {
 const { container } = renderPortfolio();
 await screen.findByText(row.title);
 const rows = container.querySelectorAll("[data-pf-vacancy-row]");
 expect(Array.from(rows).slice(0, 2).map(node => node.getAttribute("data-pf-vacancy-row"))).toEqual([unnamed.id, id]);
 const draft = rows[1] as HTMLElement;
 for (const text of ["Remoto · Tiempo completo", "Ana", "Acme", "Borrador", "Sin pipeline · en borrador", "Sin publicar", "Editado 15 de octubre de 2026"]) expect(draft).toHaveTextContent(text);
 expect(draft.querySelector('[data-slot="badge"]')).toHaveAttribute("data-variant", "info");
 expect(draft.querySelector('[data-slot="badge"]')).toHaveAttribute("data-dot");
 expect(within(draft).queryByRole("link", { name: /Ver pipeline/ })).not.toBeInTheDocument();
 expect(rows[0]).toHaveTextContent("Sin título"); expect(rows[0]).toHaveTextContent("Modalidad sin definir"); expect(rows[0]).toHaveTextContent("Usuario dado de baja");
 const trigger = within(draft).getByRole("button", { name: `Acciones de ${row.title}` });
 expect(trigger).toHaveAttribute("aria-haspopup", "menu");
 expect(trigger).toHaveTextContent("Acciones");
 expect(trigger).toHaveClass("h-10");
 // Same boundary as IngresarMenu: jsdom cannot drive the floating-ui portal.
 const source = readFileSync("src/features/employer-vacancies/vacancy-portfolio.tsx", "utf8");
 expect(source).toContain("<DropdownMenuGroup>");
 expect(portfolioRowActions(id, "draft").map(item => item.label)).toEqual(["Continuar editando", "Publicar", "Ver pipeline"]);
 expect(portfolioRowActions(id, "published").map(item => item.label)).toEqual(["Ver pipeline"]);
});
it("counts drafts in Todas, metric and filter; searches draft titles", async () => {
 const { container } = renderPortfolio(); await screen.findByText(row.title);
 expect(screen.getByRole("tab", { name: "Todas 8" })).toBeVisible();
 expect(screen.getByRole("tab", { name: "Borradores 2" })).toBeVisible();
 expect(container.querySelector('[data-pf-vacancy-metric="draft"]')).toHaveTextContent("2Borradores");
 fireEvent.click(screen.getByRole("tab", { name: "Borradores 2" }));
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(2);
 fireEvent.change(screen.getByLabelText("Buscar vacante"), { target: { value: "disenador" } });
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(1);
});
it("loads sequential opaque cursors and deduplicates rows", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: true, items: [row], nextCursor: "opaque+/=" }).mockResolvedValueOnce({ ok: true, items: [row, unnamed], nextCursor: null });
 const { container } = renderPortfolio(); await screen.findByText("Sin título");
 expect(listDraftsAction).toHaveBeenNthCalledWith(1, { limit: 50 });
 expect(listDraftsAction).toHaveBeenNthCalledWith(2, { limit: 50, cursor: "opaque+/=" });
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(8);
});
it("caps at ten pages and discloses the bounded result without retries", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row], nextCursor: "more" });
 renderPortfolio(); await waitFor(() => expect(listDraftsAction).toHaveBeenCalledTimes(10));
 expect(await screen.findByText(/Se muestran hasta 500 borradores/)).toBeVisible();
});
it("keeps prototype rows visible while draft-shaped skeleton rows load with one announcement", async () => {
 let resolve!: (result: DraftListActionResult) => void;
 vi.mocked(listDraftsAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
 const { container } = renderPortfolio();
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(6);
 expect(screen.getAllByRole("status")).toHaveLength(1);
 expect(screen.getByRole("status")).toHaveTextContent("Cargando borradores");
 expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
 expect(container.querySelectorAll('[data-pf-draft-skeleton] [data-slot="skeleton"]').length).toBeGreaterThan(5);
 const skeleton = container.querySelector('[data-pf-draft-skeleton]')!;
 const anatomy = (root: Element) => [...root.querySelectorAll('[data-pf-vacancy-zone]')].map(zone => zone.getAttribute('data-pf-vacancy-zone'));
 const loadingAnatomy = anatomy(skeleton);
 await act(async () => resolve({ ok: true, items: [unnamed], nextCursor: null }));
 const loaded = container.querySelector(`[data-pf-vacancy-row="${unnamed.id}"]`)!;
 expect(anatomy(loaded)).toEqual(loadingAnatomy);
 expect(loaded.className).toBe(skeleton.className);
});
it.each(["server_error", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "invalid_request", "no_response", "unrecognized_response"] as const)("shows persistent %s cause and explicit retry without losing prototypes", async reason => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
 const { container } = renderPortfolio(); const retry = await screen.findByRole("button", { name: "Reintentar" });
 expect(container.querySelector("[data-pf-vacancy-results]")).toContainElement(retry);
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(6);
 expect(screen.getByRole("status")).toHaveTextContent("No se cargaron los borradores");
 expect(notifyActionResult).not.toHaveBeenCalled();
 fireEvent.click(retry); await screen.findByText(row.title);
 expect(listDraftsAction).toHaveBeenCalledTimes(2);
});
it("points an empty Borradores filter to the header and offers only clearing filters", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [], nextCursor: null });
 const { container } = renderPortfolio(); await waitFor(() => expect(screen.queryByText("Cargando borradores")).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole("tab", { name: "Borradores 0" }));
 const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
 expect(empty).toHaveTextContent("No hay borradores que mostrar");
 expect(empty).toHaveTextContent("Crea una vacante con «Nueva vacante». Se guarda como borrador hasta que la publiques.");
 expect(within(empty).queryAllByRole("link")).toHaveLength(0);
 const clear = within(empty).getByRole("button", { name: "Limpiar filtros" });
 expect(within(empty).getAllByRole("button")).toEqual([clear]);
 expect(clear).toHaveClass("bg-primary");
 fireEvent.click(clear);
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(6);
 expect(screen.getByRole("tab", { name: "Todas 6" })).toHaveAttribute("aria-selected", "true");
});
it("points to the single header action without its own create button when the portfolio is empty", async () => {
 vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [], nextCursor: null });
 const { container } = render(<VacancyPortfolio vacancies={[]} />);
 await waitFor(() => expect(screen.queryByText("Cargando borradores")).not.toBeInTheDocument());
 const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
 expect(within(empty).getByText("Todavía no hay vacantes")).toHaveClass("text-xl", "font-semibold");
 expect(empty).toHaveTextContent("Crea tu primera vacante con «Nueva vacante». Se guarda como borrador hasta que la publiques.");
 expect(within(empty).queryAllByRole("link")).toHaveLength(0);
 expect(within(empty).queryAllByRole("button")).toHaveLength(0);
 expect(empty.querySelector('[data-slot="empty-header"]')).toHaveClass("max-w-md");
});
it("uses clearing filters as the only recovery when a draft search misses", async () => {
 const { container } = renderPortfolio(); await screen.findByText(row.title);
 fireEvent.click(screen.getByRole("tab", { name: "Borradores 2" }));
 fireEvent.change(screen.getByLabelText("Buscar vacante"), { target: { value: "no existe" } });
 const empty = container.querySelector("[data-pf-vacancy-empty]") as HTMLElement;
 expect(within(empty).queryAllByRole("link")).toHaveLength(0);
 const clear = within(empty).getByRole("button", { name: "Limpiar filtros" });
 expect(clear).toHaveClass("bg-primary", "w-full", "sm:w-auto");
 fireEvent.click(clear);
 expect(screen.getByText(row.title)).toBeVisible();
});
it("keeps the retry target mounted and reserves status space while an explicit retry waits", async () => {
 let resolve!: (result: DraftListActionResult) => void;
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
 const { container } = renderPortfolio();
 const retry = await screen.findByRole("button", { name: "Reintentar" });
 fireEvent.click(retry);
 expect(screen.getByRole("button", { name: "Reintentando…" })).toBe(retry);
 expect(retry).toBeDisabled();
 expect(screen.getAllByRole("status")).toHaveLength(1);
 expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(6);
 expect(container.querySelector("[data-pf-action-status-slot]")).not.toBeNull();
 await act(async () => resolve({ ok: true, items: [row], nextCursor: null }));
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Borradores cargados" }));
});
it("stops at a later-page failure and publishes no misleading partial draft counts", async () => {
 vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: true, items: [row], nextCursor: "next" }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500, code: "internal_error" } });
 renderPortfolio(); await screen.findByRole("button", { name: "Reintentar" });
 expect(screen.queryByText(row.title)).not.toBeInTheDocument();
 expect(listDraftsAction).toHaveBeenCalledTimes(2);
 expect(screen.getByText(/El servidor tuvo un problema/)).toBeVisible();
});
it("turns a rejected read into safe copy, with no exception leak or implicit retry", async () => {
 vi.mocked(listDraftsAction).mockRejectedValueOnce(new Error("private exception"));
 const { container } = renderPortfolio(); await screen.findByRole("button", { name: "Reintentar" });
 expect(container).toHaveTextContent("No hubo respuesta del servidor");
 expect(container).not.toHaveTextContent("private exception");
 expect(listDraftsAction).toHaveBeenCalledTimes(1);
});
it("does not follow another cursor after unmount", async () => {
 let resolve!: (result: DraftListActionResult) => void;
 vi.mocked(listDraftsAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
 const { unmount } = renderPortfolio(); unmount();
 await act(async () => resolve({ ok: true, items: [row], nextCursor: "next" }));
 expect(listDraftsAction).toHaveBeenCalledTimes(1);
});

it("reads like the validated rows: singular count, no zero counts, «Activa» and real in-process candidates in the metric", async () => {
  // Seen in Chromium: «1 candidatos», «0 candidatos · 0 en proceso» next to «Sin candidatos todavía», «Publicada» vs «Activa».
  const one = { total: 1, in_process: 1, discarded: 0, by_stage: [{ id, kind: "screening" as const, name: "Screening", count: 1 }] };
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [
    { ...row, status: "published", process: "active", published_at: "2026-10-16T12:00:00Z", candidates: one },
    { ...row, id: "923e4567-e89b-42d3-a456-426614174000", title: "Vacía", status: "published", process: "active", published_at: "2026-10-16T12:00:00Z", candidates: { total: 0, in_process: 0, discarded: 0, by_stage: [] } },
  ], nextCursor: null });
  render(<VacancyPortfolio vacancies={[]} />);
  expect(await screen.findByText("1 candidato · 1 en proceso")).toBeVisible();
  expect(screen.queryByText(/^0 candidatos/)).toBeNull();
  expect(screen.getByText("Sin candidatos todavía")).toBeVisible();
  expect(screen.queryByText("Publicada", { selector: '[data-slot="badge"]' })).toBeNull();
  expect(screen.getAllByText("Activa", { selector: '[data-slot="badge"]' })).toHaveLength(2);
  expect(screen.getByText("Candidatos en proceso").closest("[data-slot=card]")).toHaveTextContent("1");
});
