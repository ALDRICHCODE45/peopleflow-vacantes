import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ saveDraftPipelineAction: vi.fn(), loadDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { saveDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { PipelineStageEditor } from "./editor";
import { pipelineFixture } from "./test-fixture";
import { stageRowActions } from "./stage-row";
import { editorFromPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { notifyActionResult } from "@/components/feedback/notify";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("locks drag, add and remove with a visible explanation but saves renamed columns", async () => {
  const pipeline = { ...pipelineFixture(), structure_locked: true };
  pipeline.stages.splice(4, 0, { id: "c", kind: "custom", name: "Técnica" });
  render(<PipelineStageEditor draftId="vacancy" pipeline={pipeline} etag={'"opaque"'} />);
  expect(screen.getByText("Esta vacante ya tiene candidatos: solo puedes renombrar las columnas.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Agregar columna" })).toBeDisabled();
  for (const handle of screen.getAllByRole("button", { name: /^Arrastrar / })) expect(handle).toBeDisabled();
  // Menus cannot open in jsdom (rules §13.7); verify their public action list.
  const actions = stageRowActions(editorFromPipeline(pipeline), "c");
  expect(actions.filter(action => action.id !== "substates").every(action => action.disabled)).toBe(true);
  const field = screen.getByRole("textbox", { name: "Nombre de la columna 2" }); expect(field).toBeEnabled();
  fireEvent.change(field, { target: { value: "Filtro" } });
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: { ...pipeline, version: "1", stages: pipeline.stages.map(stage => stage.id === "s" ? { ...stage, name: "Filtro" } : stage) }, etag: '"new"' });
  await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveDraftPipelineAction).mock.calls[0][0]).toMatchObject({ ifMatch: '"opaque"', body: { stages: expect.arrayContaining([{ id: "s", name: "Filtro" }]) } });
});
it("retains edits and shows the specific authority conflict when candidates arrive during editing", async () => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: false, reason: "stage_change_requires_empty_pipeline", reference: { status: 409, code: "stage_change_requires_empty_pipeline" } });
  render(<PipelineStageEditor draftId="vacancy" pipeline={pipelineFixture()} etag={'"opaque"'} />);
  const field = screen.getByRole("textbox", { name: "Nombre de la columna 2" }); fireEvent.change(field, { target: { value: "Filtro" } });
  await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Solo puedes renombrar las columnas", description: expect.stringContaining("Tus cambios siguen aquí") })));
  expect(field).toHaveValue("Filtro"); expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
