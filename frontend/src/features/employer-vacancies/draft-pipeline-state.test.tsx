import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { loadBoardAction } from "@/features/pipeline-movement/actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { DraftPipelineState } from "./draft-pipeline-state";
vi.mock("@/features/pipeline-movement/actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
// Like the real header: `title={null}` drops the heading (the vacancy frame owns the h1) and nothing but the crumb is passed.
const headerProps = vi.hoisted(() => ({ calls: [] as { title?: string | null; status?: unknown }[] }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title, parent, status }: { title?: React.ReactNode; parent: { label: string; href: string }; status?: React.ReactNode }) => { headerProps.calls.push({ title: title as string | null | undefined, status }); return <header>{title !== null && <h1>{title}</h1>}<a href={parent.href}>{parent.label}</a>{status}</header>; } }));
const read = filledDraftRead();
const success = { ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: null, process: null } }, identity: { draftId: read.id, etag: '"etag"' } } as const;
/** A board with the given lifecycle, for screens that open the board (the lifecycle has a process). */
const boardWith = (lifecycle: unknown) => ({ ok: true, data: { lifecycle, screening_filters: [], retired_stages: [], delivery: { state: "pending", delivered: 0, target: 3 }, substates: [], stages: [{ id: read.id, kind: "new", name: "Entrada actual", count: 0 }], exit: { id: "exit", kind: "discarded", name: "Fuera actual", count: 0 }, coverage: { covered: 0, required: null, full_coverage_reached_at: null }, participations: [] } }) as unknown as Awaited<ReturnType<typeof loadBoardAction>>;
beforeEach(() => {
  vi.resetAllMocks();
  headerProps.calls.length = 0;
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success);
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "not_found", reference: {} });
});
afterEach(cleanup);
it("loads draft and readiness and reserves the empty-state composition", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  expect(loadDraftForEditAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando borrador");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
  const slots = () => [...container.querySelectorAll('[data-slot^="card"], [data-slot^="empty"]')].map(node => node.getAttribute("data-slot"));
  const loadingSlots = slots();
  expect(container.querySelectorAll('[data-slot="empty-content"] [data-slot="skeleton"]')).toHaveLength(2);
  await act(async () => resolve(success));
  expect(slots()).toEqual(loadingSlots);
  expect(container.querySelectorAll('[data-slot="empty-content"] button, [data-slot="empty-content"] a')).toHaveLength(2);
});
it.each([read.fields.title, null])("renders title %s, badge, empty state and configuration entry points", async title => {
  const seed = { ...success.seed, model: { ...success.seed.model, fields: { ...success.seed.model.fields, title } } };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed });
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: title || "Sin título" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "Pipeline" })).toBeVisible();
  // Primary decision in the card: «Publicar vacante» (primary) next to «Continuar editando» (outline).
  const empty = container.querySelector('[data-slot="card-content"] [data-slot="empty"]')!;
  const publish = within(empty as HTMLElement).getByRole("button", { name: "Publicar vacante" });
  expect(publish).toHaveClass("bg-primary");
  const edit = within(empty as HTMLElement).getByRole("link", { name: "Continuar editando" });
  expect(edit).toHaveAttribute("href", `/empresa/vacantes/borradores/${read.id}`);
  expect(edit).not.toHaveClass("bg-primary");
  expect(edit.className).toContain("border");
  expect(publish.parentElement).toHaveClass("flex-col", "sm:flex-row");
  expect(screen.getByRole("heading", { name: "Esta vacante todavía no tiene pipeline" })).toBeVisible();
  expect(screen.getByText("Da seguimiento a los candidatos de esta vacante.")).toBeVisible();
  expect(screen.getByText("Los candidatos aparecerán aquí una vez que publiques la vacante. Mientras tanto, puedes continuar editándola y preparar todo antes de publicar.")).toBeVisible();
  // State and pipeline settings in the card header; one configuration entry point.
  const header = container.querySelector('[data-slot="card-header"]')!;
  expect(within(header as HTMLElement).getByText("Vacante en borrador")).toBeVisible();
  const columns = within(header.querySelector('[data-slot="card-action"]') as HTMLElement).getByRole("link", { name: "Configurar columnas" });
  expect(columns).toHaveAttribute("href", `/empresa/vacantes/${read.id}/configuracion/columnas`);
  // Besides the «Configuración» tab (navigation of the frame), the draft card has this one entry point.
  expect(screen.getAllByRole("link", { name: /Configurar/ })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", `/empresa/vacantes/${read.id}/configuracion`);
  expect(screen.queryByRole("link", { name: "Configuración de la vacante" })).not.toBeInTheDocument();
  expect(within(container.querySelector('[data-slot="card-footer"]') as HTMLElement).getByText("Puedes configurar las columnas de tu proceso antes de publicar.")).toBeVisible();
  // Leaving the screen is navigation, outside the card.
  const back = screen.getByRole("link", { name: "Volver a Vacantes" });
  expect(back).toHaveAttribute("href", "/empresa/vacantes");
  expect(back.closest('[data-slot="card"]')).toBeNull();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-dot");
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-variant", "info");
  expect(container.querySelectorAll("header")).toHaveLength(1);
  expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
  expect(container.firstElementChild).not.toHaveClass("md:h-[calc(100dvh-1rem)]", "md:overflow-hidden");
});
it.each([["paused", "Pausada", "review"], ["closed", "Cerrada · proceso en curso", "neutral"]] as const)("uses %s lifecycle in the header", async (publication, label, variant) => {
  const lifecycle = { ...success.seed.lifecycle, publication, process: "active" as const };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle } });
  vi.mocked(loadBoardAction).mockResolvedValue(boardWith(lifecycle));
  render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByText(label)).toHaveAttribute("data-variant", variant);
});
it("published state renders current column cards and hides publish", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle: { ...success.seed.lifecycle, publication: "published", process: "active" } } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: { lifecycle: { close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: "2026-10-16T12:00:00Z", paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] }, screening_filters: [], retired_stages: [], delivery: { state: "pending", delivered: 0, target: 3 }, substates: [], stages: [{ id: read.id, kind: "new", name: "Entrada actual", count: 0 }, { id: "other", kind: "custom", name: "Prueba actual", count: 0 }], exit: { id: "exit", kind: "discarded", name: "Fuera actual", count: 0 }, coverage: { covered: 0, required: null, full_coverage_reached_at: null }, participations: [] } });
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada actual" });
  expect(screen.getByRole("heading", { name: "Prueba actual" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Fuera actual" })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-dot");
  expect(screen.getByText("16 oct 2026").closest("p")).toHaveTextContent("Publicada el 16 oct 2026");
  expect(screen.getAllByText("Sin candidatos en esta etapa")).toHaveLength(3);
  expect(screen.getByText(/candidatos en el pipeline/)).toHaveTextContent("0 candidatos en el pipeline");
  expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-pf-published-column]')).toHaveLength(3);
  expect(container.firstElementChild).toHaveClass("min-h-0", "md:h-[calc(100dvh-1rem)]", "md:flex-none", "md:overflow-hidden");
  const content = container.querySelector('[data-pf-page-content]');
  expect(content).toHaveClass("min-h-0", "flex-1");
  expect(content?.parentElement).toHaveClass("min-h-0", "flex-1");
  expect(screen.getByRole("region", { name: "Tablero de candidatos" })).toHaveClass("min-h-0", "flex-1");
  expect(loadBoardAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(read.id);
});
it.each(["not_found", "forbidden", "server_error", "no_response"] as const)("shows draft failure %s and retries only the draft", async reason => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ ok: false, reason });
  render(<DraftPipelineState draftId={read.id} />);
  expect(screen.queryByText("Esta vacante todavía no tiene pipeline")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Esta vacante todavía no tiene pipeline" });
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2);
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
});
it("turns a rejected draft read into a safe error", async () => {
  vi.mocked(loadDraftForEditAction).mockRejectedValueOnce(new Error("network"));
  render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
it("ignores stale results when the id changes", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  const { rerender } = render(<DraftPipelineState draftId={read.id} />);
  rerender(<DraftPipelineState draftId="223e4567-e89b-42d3-a456-426614174000" />);
  await screen.findByRole("heading", { name: "No encontramos este borrador" });
  await act(async () => resolve(success));
  expect(screen.queryByText("Esta vacante todavía no tiene pipeline")).not.toBeInTheDocument();
});
it("S6/S9: the identity row of a replacement carries «Reemplazo» and «Privada» next to its state, wrapping with the title", async () => {
  const lifecycle = { ...success.seed.lifecycle, publication: "published" as const, process: "active" as const, kind: "replacement" as const, replacement_of: "223e4567-e89b-42d3-a456-426614174000", visibility: "private" as const };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle } });
  // Private replacement: the publication read says «draft» (contract D4) and the screen still opens the board from the lifecycle.
  vi.mocked(loadBoardAction).mockResolvedValue(boardWith(lifecycle));
  render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada actual" });
  const row = (await screen.findByRole("heading", { level: 1 })).parentElement as HTMLElement;
  expect(row).toHaveClass("flex-wrap");
  expect(within(row).getByText("Activa")).toBeVisible();
  expect(within(row).getByText("Reemplazo")).toHaveAttribute("data-slot", "badge");
  expect(within(row).getByText("Privada")).toHaveAttribute("data-slot", "badge");
  // The top bar keeps only the back crumb: neither title nor badges.
  const header = screen.getByRole("link", { name: "Vacantes" }).closest("header") as HTMLElement;
  expect(within(header).queryByText("Activa")).not.toBeInTheDocument();
  expect(within(header).queryByRole("heading")).not.toBeInTheDocument();
});
it("S9: the pipeline route renders the vacancy tabs with Pipeline current, and passes the SiteHeader no title or status", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle: { ...success.seed.lifecycle, publication: "published", process: "active" } } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  vi.mocked(loadBoardAction).mockResolvedValue(boardWith({ ...success.seed.lifecycle, publication: "published", process: "active", published_at: "2026-10-16T12:00:00Z" }));
  render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada actual" });
  const tabs = within(screen.getByRole("navigation", { name: "Secciones de la vacante" })).getAllByRole("link");
  expect(tabs.map(link => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
    ["Pipeline", `/empresa/vacantes/${read.id}/pipeline`, "page"],
    ["Documentos", `/empresa/vacantes/${read.id}/documentos`, null],
    ["Configuración", `/empresa/vacantes/${read.id}/configuracion`, null],
  ]);
  expect(headerProps.calls.length).toBeGreaterThan(0);
  for (const call of headerProps.calls) expect(call).toEqual({ title: null, status: undefined });
  expect(screen.queryByRole("heading", { level: 2, name: "Pipeline" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Configuración de la vacante" })).not.toBeInTheDocument();
});
it("S9: a closed process shows «Proceso finalizado el» and «Motivo de cierre» (with the board's live coverage) in the identity row, and the notice stays in the board", async () => {
  const lifecycle = { ...success.seed.lifecycle, publication: "closed" as const, process: "finished" as const, close_reason: "filled" as const, closed_at: "2026-10-19T12:00:00Z", process_finished_at: "2026-10-20T12:00:00Z", allowed_actions: [] };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle } });
  const board = boardWith(lifecycle);
  if (board.ok) board.data.coverage = { covered: 1, required: 2, full_coverage_reached_at: null };
  vi.mocked(loadBoardAction).mockResolvedValue(board);
  render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada actual" });
  const row = screen.getByRole("heading", { level: 1 }).parentElement!.parentElement as HTMLElement;
  expect(within(row).getByText(/Proceso finalizado el/)).toHaveTextContent("Proceso finalizado el 20 oct 2026");
  await waitFor(() => expect(within(row).getByText(/Motivo de cierre/)).toHaveTextContent("Motivo de cierre: Cubierta al cierre"));
  const region = screen.getByRole("region", { name: "Tablero de candidatos" });
  expect(region).not.toContainElement(within(row).getByText(/Proceso finalizado el/));
  expect(region).not.toContainElement(within(row).getByText(/Motivo de cierre/));
  expect(within(region).getByText(/El proceso de esta vacante finalizó/)).toBeVisible();
  expect(screen.getAllByText(/Motivo de cierre/)).toHaveLength(1);
});
