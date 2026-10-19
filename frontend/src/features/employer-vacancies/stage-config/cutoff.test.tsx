import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { saveDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { editorFromPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { stageRowActions, StageRow } from "./stage-row";
import { PipelineStageEditor } from "./editor";
import { pipelineFixture } from "./test-fixture";
import { deliveryFixture } from "../delivery-config/test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Keep the real row/badges/actions, expose only the callback at the jsdom menu boundary.
vi.mock("./stage-row", async importOriginal => {
  const original = await importOriginal<typeof import("./stage-row")>();
  return { ...original, StageRow: (props: Parameters<typeof StageRow>[0]) => <><original.StageRow {...props} />{props.stage.kind === "custom" && <button onClick={props.onRemove}>Probe quitar {props.stage.name}</button>}</> };
});
function confirmSave() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Guardar" }));
}
const draftId = "123e4567-e89b-42d3-a456-426614174000";
function pipeline() { const value = pipelineFixture(); value.stages.splice(4, 0, { id: "custom", kind: "custom", name: "Técnica" }); return value; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: "cutoff_stage_in_use", reference: { status: 409, code: "cutoff_stage_in_use" } }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), cutoffStageId: "custom" }, etag: '"delivery"' }); });
afterEach(cleanup);
it("disables remove only for the current persisted cutoff, never all unsaved customs", () => {
  const state = editorFromPipeline(pipeline());
  expect(stageRowActions(state, "custom", "custom")).toContainEqual({ id: "remove", label: "Quitar columna", disabled: true });
  expect(stageRowActions(state, "custom", "s")).toContainEqual({ id: "remove", label: "Quitar columna", disabled: false });
  state.stages.find(stage => stage.id === "custom")!.id = null;
  expect(stageRowActions(state, "custom", null)).toContainEqual({ id: "remove", label: "Quitar columna", disabled: false });
});
it("marks the cutoff with the shared info badge without a lifecycle dot", () => {
  render(<PipelineStageEditor draftId={draftId} pipeline={pipeline()} etag='"pipeline"' cutoffStageId="custom" />);
  const badge = screen.getByText("Corte de entrega"); expect(badge).toHaveAttribute("data-variant", "info"); expect(badge).not.toHaveAttribute("data-dot"); expect(badge.closest('[data-slot="item"]')).toHaveTextContent("Columna propia");
  fireEvent.click(screen.getByRole("button", { name: "Probe quitar Técnica" })); expect(screen.getByRole("textbox", { name: "Nombre de la columna 5" })).toHaveValue("Técnica");
});
it.each([null, "s"])("refreshes a stale/unknown cutoff %j exactly once on 409 and keeps all edited data", async cutoffStageId => {
  render(<PipelineStageEditor draftId={draftId} pipeline={pipeline()} etag='"pipeline"' cutoffStageId={cutoffStageId} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la columna 2" }), { target: { value: "Filtro" } });
  fireEvent.click(screen.getByRole("button", { name: "Probe quitar Técnica" })); confirmSave();
  await waitFor(() => expect(loadDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith(draftId));
  expect(screen.getByRole("textbox", { name: "Nombre de la columna 2" })).toHaveValue("Filtro"); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveDraftPipelineAction).mock.calls[0][0].body).toMatchObject({ stages: expect.not.arrayContaining([expect.objectContaining({ id: "custom" })]) });
  expect(await screen.findByText("Corte de entrega")).toBeVisible(); expect(screen.getByText(/Técnica.*corte de entrega/)).toHaveAttribute("data-slot", "field-error");
  const link = screen.getByRole("link", { name: "Ir a Entrega" }); expect(link).toHaveAttribute("href", `/empresa/vacantes/${draftId}/configuracion/entrega`);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No puedes quitar la columna de corte", description: "Esa columna es el corte de entrega. Cambia la columna de corte en Entrega antes de quitarla.", action: expect.objectContaining({ title: "Ir a Entrega" }) }));
});
it("does not refetch a known cutoff among the removed stages on a subsequent rejection", async () => {
  render(<PipelineStageEditor draftId={draftId} pipeline={pipeline()} etag='"pipeline"' />);
  fireEvent.click(screen.getByRole("button", { name: "Probe quitar Técnica" }));
  confirmSave();
  await screen.findByText(/Técnica.*corte de entrega/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled());
  confirmSave();
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(2));
  expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("keeps the 409 guidance and edits even if the cutoff refresh fails", async () => {
  vi.mocked(loadDraftDeliveryAction).mockRejectedValue(new Error("unsafe"));
  render(<PipelineStageEditor draftId={draftId} pipeline={pipeline()} etag='"pipeline"' />);
  fireEvent.click(screen.getByRole("button", { name: "Probe quitar Técnica" }));
  confirmSave();
  expect(await screen.findByRole("link", { name: "Ir a Entrega" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled());
  expect(loadDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith(draftId); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Probe quitar Técnica" })).not.toBeInTheDocument();
});
it("badges a refreshed cutoff that is still present, without replacing edited columns", async () => {
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), cutoffStageId: "s" }, etag: '"delivery"' });
  render(<PipelineStageEditor draftId={draftId} pipeline={pipeline()} etag='"pipeline"' cutoffStageId={null} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la columna 2" }), { target: { value: "Filtro" } }); confirmSave();
  expect(await screen.findByText("Corte de entrega")).toBeVisible(); expect(screen.getByRole("textbox", { name: "Nombre de la columna 2" })).toHaveValue("Filtro"); expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
