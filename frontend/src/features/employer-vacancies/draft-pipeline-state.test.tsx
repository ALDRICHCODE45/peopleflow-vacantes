import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPipelineAction, type DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { pipelineFixture } from "./stage-config/test-fixture";
import { DraftPipelineState } from "./draft-pipeline-state";
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title, parent, status }: { title: React.ReactNode; parent: { label: string; href: string }; status: React.ReactNode }) => <header><h1>{title}</h1><a href={parent.href}>{parent.label}</a>{status}</header> }));
const read = filledDraftRead();
const success = { ok: true, seed: draftEditSeedFromRead(read), identity: { draftId: read.id, etag: '"etag"' } } as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success);
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: pipelineFixture(), etag: '"pipeline-0"' });
});
afterEach(cleanup);
it("starts both loads in parallel and reserves the editor composition with one announcement", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando pipeline");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(10);
  expect(container.querySelectorAll("header")).toHaveLength(1);
  await act(async () => resolve(success));
});
it.each([read.fields.title, null])("renders title %s, lifecycle badge, context and the editor", async title => {
  const seed = { ...success.seed, model: { ...success.seed.model, fields: { ...success.seed.model.fields, title } } };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed });
  const { container } = render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: title || "Sin título" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Pipeline", level: 2 })).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Columnas del pipeline", level: 3 })).toBeVisible();
  expect(container).toHaveTextContent("Configura las columnas por las que pasarán los candidatos de esta vacante. Los candidatos aparecerán aquí cuando se publique.");
  expect(screen.queryByText("Esta vacante todavía no tiene pipeline")).not.toBeInTheDocument();
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-dot");
  expect(container.querySelector('[data-slot="badge"]')).toHaveAttribute("data-variant", "info");
  expect(container.querySelectorAll("header")).toHaveLength(1);
});
it.each(["not_found", "forbidden", "server_error", "no_response"] as const)("reuses the draft edit error for %s and retries explicitly", async reason => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ ok: false, reason });
  render(<DraftPipelineState draftId={read.id} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Columnas del pipeline" });
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2);
});
it.each([
  ["unauthenticated", "Tu sesión expiró"], ["not_found", "No encontramos este borrador"],
  ["forbidden", "No tienes permiso para abrirlo"], ["company_inactive", "Falta configurar tu empresa"],
  ["company_not_active", "Falta configurar tu empresa"], ["server_error", "El servidor tuvo un problema"],
  ["no_response", "No hubo respuesta del servidor"], ["validation_error", "No pudimos confirmar el resultado"],
  ["unrecognized_response", "No pudimos confirmar el resultado"], ["future_reason", "No pudimos confirmar el resultado"],
])("maps pipeline load %s onto the page Empty and explicit retry", async (reason, title) => {
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: reason as DraftPipelineActionFailure["reason"], reference: {} });
  render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Columnas del pipeline" }); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2);
});
it("turns rejected load promises into safe page errors", async () => {
  vi.mocked(loadDraftPipelineAction).mockRejectedValueOnce(new Error("network"));
  render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
it("ignores stale results when the id changes", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  const { rerender } = render(<DraftPipelineState draftId={read.id} />);
  rerender(<DraftPipelineState draftId="223e4567-e89b-42d3-a456-426614174000" />);
  await screen.findByRole("heading", { name: "No encontramos este borrador" });
  await act(async () => resolve(success)); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
