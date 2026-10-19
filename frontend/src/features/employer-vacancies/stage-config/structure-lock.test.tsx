import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ saveDraftPipelineAction: vi.fn(), loadDraftPipelineAction: vi.fn(), previewPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { saveDraftPipelineAction, previewPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { PipelineStageEditor } from "./editor";
import { pipelineFixture } from "./test-fixture";
import { stageRowActions } from "./stage-row";
import { editorFromPipeline, canMoveTo, canRemoveStage } from "@/features/jobs/drafts/pipeline/editor-model";
import { notifyActionResult } from "@/components/feedback/notify";
const emptyImpact = { not_applicable: [], recovery_reassigned: [] };
const candidate = { id: "candidate", full_name: "Ana Pérez" };
const preview = { stages: pipelineFixture().stages, has_impact: true, not_applicable: [{ participation_id: "a", candidate, stage_id: "s" }], recovery_reassigned: [{ participation_id: "a", candidate, retired_stage_id: "c", default_stage_id: "n" }] };
function setup(locked = true) {
  const pipeline = { ...pipelineFixture(), structure_locked: locked, retired: [] };
  pipeline.stages.splice(4, 0, { id: "c", kind: "custom", name: "Técnica" });
  vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview });
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...pipeline, version: "1", applied_impact: emptyImpact }, etag: '"new"' });
  render(<PipelineStageEditor draftId="vacancy" pipeline={pipeline} etag={'"opaque"'} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la columna 2" }), { target: { value: "Filtro" } });
  return pipeline;
}
async function open() { await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" })); return screen.findByRole("alertdialog"); }
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("allows structure edits with candidates but keeps built-ins and fixed endpoints", () => {
  const pipeline = setup();
  expect(screen.getByText("Esta vacante ya tiene candidatos: antes de guardar cambios de estructura verás a quién afecta. Nadie cambia de columna.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Agregar columna" })).toBeEnabled();
  for (const handle of screen.getAllByRole("button", { name: /^Arrastrar / })) expect(handle).toBeEnabled();
  const state = editorFromPipeline(pipeline);
  expect(stageRowActions(state, "c").find(action => action.id === "remove")?.disabled).toBe(false);
  for (const stage of state.stages.filter(stage => stage.kind !== "custom")) expect(canRemoveStage(state, stage.key)).toBe(false);
  expect(canMoveTo(state, "n", 2)).toBe(false); expect(canMoveTo(state, "p", 2)).toBe(false);
  expect(canMoveTo(state, "s", 0)).toBe(false); expect(canMoveTo(state, "s", 5)).toBe(false);
});
it("previews, groups real impact, cancels without writing then confirms with ETag", async () => {
  setup(); const dialog = await open();
  expect(previewPipelineAction).toHaveBeenCalledTimes(1); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  expect(within(dialog).getByText("¿Guardar los cambios de columnas?")).toBeVisible();
  expect(within(dialog).getByText("Ningún candidato cambia de columna. El nuevo orden aplica a los próximos movimientos.")).toBeVisible();
  expect(within(dialog).getByText("No aplica por cambio de proceso")).toBeVisible();
  expect(within(dialog).getByText("Al recuperarse elegirán columna")).toBeVisible();
  expect(within(dialog).getByText("Ana Pérez → Screening")).toBeVisible();
  expect(within(dialog).getByText("Ana Pérez → Técnica → Nuevos")).toBeVisible();
  expect(dialog.querySelector('[data-slot="confirm-action-details"]')).not.toBeNull();
  await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  const reopened = await open();
  await userEvent.setup().click(within(reopened).getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveDraftPipelineAction).mock.calls[0][0]).toMatchObject({ ifMatch: '"opaque"', body: { confirm_impact: true } });
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Columnas guardadas.", description: expect.stringContaining("El impacto cambió desde la vista previa:") }));
});
it("without candidates confirms without preview or impact details", async () => {
  setup(false); const dialog = await open();
  expect(previewPipelineAction).not.toHaveBeenCalled();
  expect(dialog.querySelector('[data-slot="confirm-action-details"]')).toBeNull();
  await userEvent.setup().click(within(dialog).getByRole("button", { name: "Guardar" }));
  expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it("blocks duplicate preview requests and names new server-assigned columns in the scrolling details slot", async () => {
  setup(); let resolve!: (value: Awaited<ReturnType<typeof previewPipelineAction>>) => void;
  vi.mocked(previewPipelineAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
  const pending = screen.getByRole("button", { name: "Revisando impacto…" });
  expect(pending).toBeDisabled(); fireEvent.click(pending);
  expect(previewPipelineAction).toHaveBeenCalledTimes(1); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  await act(async () => resolve({ ok: true, preview: { ...preview,
    stages: [...preview.stages, { id: "server-new", kind: "custom", name: "Evaluación nueva" }],
    not_applicable: Array.from({ length: 50 }, (_, index) => ({ participation_id: String(index), candidate: { ...candidate, full_name: `Persona ${index}` }, stage_id: "server-new" })),
  } }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("Persona 49 → Evaluación nueva")).toBeVisible();
  expect(dialog.querySelector('[data-slot="confirm-action-details"]')).toHaveClass("overflow-y-auto");
  expect(dialog.querySelector('[data-slot="alert-dialog-header"] .lucide-columns-3')).not.toBeNull();
  for (const card of dialog.querySelectorAll('[data-slot="card"]')) expect(card).toHaveClass("shrink-0");
  expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
});
it("omits details for a preview with no impact", async () => {
  setup(); vi.mocked(previewPipelineAction).mockResolvedValue({ ok: true, preview: { ...preview, ...emptyImpact, has_impact: false } });
  expect((await open()).querySelector('[data-slot="confirm-action-details"]')).toBeNull();
});
it("requires explicit new preview after impact_confirmation_required", async () => {
  setup(); vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: "impact_confirmation_required", reference: { status: 409 } });
  const dialog = await open(); await userEvent.setup().click(within(dialog).getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(previewPipelineAction).toHaveBeenCalledTimes(1); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  await userEvent.setup().click(screen.getByRole("button", { name: "Revisar impacto de nuevo" }));
  await screen.findByRole("alertdialog"); expect(previewPipelineAction).toHaveBeenCalledTimes(2); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it("failed preview says nothing was saved, never suggests an uncertain write", async () => {
  setup(); vi.mocked(previewPipelineAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ description: "No pudimos revisar el impacto. No se guardó ningún cambio. Puedes revisar de nuevo; es seguro." })));
  expect(screen.queryByRole("button", { name: "Comprobar" })).toBeNull();
  expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
it("names occupied columns and links to the board without retrying", async () => {
  setup(); vi.mocked(previewPipelineAction).mockResolvedValue({ ok: false, reason: "stage_occupied", details: [{ stage_id: "c" }], reference: { status: 409 } });
  await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ description: "Mueve a los candidatos de «Técnica» antes de quitarla." })));
  expect(screen.getByRole("link", { name: "Ir al tablero" })).toHaveAttribute("href", "/empresa/vacantes/vacancy");
  expect(previewPipelineAction).toHaveBeenCalledTimes(1); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
});
