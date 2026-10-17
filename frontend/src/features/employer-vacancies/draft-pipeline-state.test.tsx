import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title, parent, status }: { title: React.ReactNode; parent: { label: string; href: string }; status: React.ReactNode }) => <header><h1>{title}</h1><a href={parent.href}>{parent.label}</a>{status}</header> }));
const read = filledDraftRead();
const success = { ok: true, seed: draftEditSeedFromRead(read), identity: { draftId: read.id, etag: '"etag"' } } as const;
beforeEach(() => {
  vi.resetAllMocks();
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
  await act(async () => resolve(success));
});
it.each([read.fields.title, null])("renders title %s, badge, empty state and configuration entry points", async title => {
  const seed = { ...success.seed, model: { ...success.seed.model, fields: { ...success.seed.model.fields, title } } };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed });
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: title || "Sin título" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "Pipeline" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Publicar" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Esta vacante todavía no tiene pipeline" })).toBeVisible();
  expect(screen.getByText("Da seguimiento a los candidatos de esta vacante.")).toBeVisible();
  expect(screen.getByText("Esta vacante está en borrador. Los candidatos aparecerán aquí una vez que se publique. Puedes continuar editándola y preparar todo antes de publicar.")).toBeVisible();
  for (const name of ["Configuración de la vacante", "Configurar columnas"]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/empresa/vacantes/${read.id}/configuracion/columnas`);
  }
  const gear = screen.getByRole("link", { name: "Configuración de la vacante" });
  expect(gear).toHaveClass("size-10");
  expect(gear).toHaveAttribute("data-slot", "tooltip-trigger");
  expect(screen.getByRole("link", { name: "Continuar editando" })).toHaveAttribute("href", `/empresa/vacantes/borradores/${read.id}`);
  expect(screen.getByRole("link", { name: "Volver a Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-dot");
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-variant", "info");
  expect(container.querySelectorAll("header")).toHaveLength(1);
  expect(container.firstElementChild).not.toHaveClass("md:h-[calc(100dvh-1rem)]", "md:overflow-hidden");
});
it("published state renders current column cards and hides publish", async () => {
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: { stages: [{ id: read.id, kind: "new", name: "Entrada actual", count: 0 }, { id: "other", kind: "custom", name: "Prueba actual", count: 0 }], exit: { id: "exit", kind: "discarded", name: "Fuera actual", count: 0 }, coverage: { covered: 0, required: null, full_coverage_reached_at: null }, participations: [] } });
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada actual" });
  expect(screen.getByRole("heading", { name: "Prueba actual" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Fuera actual" })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-dot");
  expect(screen.getByText("16 oct 2026").closest("p")).toHaveTextContent("Publicada el 16 oct 2026");
  expect(screen.getAllByText("Sin candidatos en esta etapa")).toHaveLength(3);
  expect(screen.getByText(/candidatos en el pipeline/)).toHaveTextContent("0 candidatos en el pipeline");
  expect(screen.queryByRole("button", { name: "Publicar" })).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-pf-published-column]')).toHaveLength(3);
  expect(container.firstElementChild).toHaveClass("min-h-0", "md:h-[calc(100dvh-1rem)]", "md:flex-none", "md:overflow-hidden");
  const content = container.querySelector('[data-pf-page-content]');
  expect(content).toHaveClass("min-h-0", "flex-1");
  expect(content?.parentElement).toHaveClass("min-h-0", "flex-1");
  expect(screen.getByRole("region", { name: "Tablero de candidatos" })).toHaveClass("min-h-0", "flex-1");
  expect(loadBoardAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPipelineAction).not.toHaveBeenCalled();
});
it("composes the installed tooltip with the configuration copy", () => {
  // Portal positioning is a browser boundary; opening it in jsdom stalls subsequent tests.
  const source = readFileSync(join(process.cwd(), "src/features/employer-vacancies/draft-pipeline-state.tsx"), "utf8");
  expect(source).toContain('from "@/components/ui/tooltip"');
  expect(source).toContain("<TooltipContent>Configuración de la vacante</TooltipContent>");
  expect(source).toContain("<TooltipProvider>");
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
