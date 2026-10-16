import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PipelineStageEditor } from "./editor";
import { pipelineFixture } from "./test-fixture";
import { populatedSubstates, substatesFixture } from "../substates-config/test-fixture";
import { saveDraftSubstatesAction } from "@/features/jobs/drafts/pipeline/substates-actions";
import { loadDraftPipelineAction, saveDraftPipelineAction, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
// Capture the real row callback at the portal boundary, without a production test-only prop.
const boundary = vi.hoisted(() => ({ open: undefined as (() => void) | undefined, disabled: false }));
vi.mock("./stage-row", async importOriginal => {
  const actual = await importOriginal<typeof import("./stage-row")>();
  return { ...actual, StageRow: (props: Parameters<typeof actual.StageRow>[0] & { onSubstates?: () => void }) => {
    if (props.stage.kind === "in_process") { boundary.open = props.onSubstates; boundary.disabled = props.disabled; }
    return <actual.StageRow {...props} />;
  } };
});
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const column = () => screen.getByRole("textbox", { name: "Nombre de la columna 4" });
beforeEach(() => { vi.resetAllMocks(); boundary.open = undefined; });
afterEach(cleanup);
it.each([0, 1, 3])("counts %i saved substates on the in_process row only, with a neutral undotted badge", count => {
  const catalog = { ...populatedSubstates(), substates: populatedSubstates().substates.slice(0, count) };
  render(<PipelineStageEditor draftId={draftId} pipeline={pipelineFixture()} etag='"pipeline-0"' substates={catalog} substatesEtag='"substates-1"' />);
  const badge = screen.getByText(count === 0 ? "Sin subestados" : count === 1 ? "1 subestado" : `${count} subestados`);
  expect(badge).toHaveAttribute("data-variant", "neutral"); expect(badge).not.toHaveAttribute("data-dot");
  expect(badge.closest("li")).toContainElement(column());
});
it("opens with the typed normalized name despite unsaved columns, saves independently and updates the saved count", async () => {
  const catalog = { ...substatesFixture(), version: "1", substates: [{ id: "new", name: "Primera entrevista" }] };
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue({ ok: true, catalog, etag: '"substates-1"' });
  render(<PipelineStageEditor draftId={draftId} pipeline={pipelineFixture()} etag='"pipeline-0"' substates={substatesFixture()} substatesEtag='"substates-0"' />);
  fireEvent.change(column(), { target: { value: "  Entrevistas\u00a0 técnicas  " } });
  expect(boundary.disabled).toBe(false); expect(boundary.open).toBeTypeOf("function"); act(() => boundary.open?.());
  expect(screen.getByRole("dialog", { name: "Subestados de Entrevistas técnicas" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Agregar Primera entrevista" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar subestados" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(column()).toHaveValue("  Entrevistas\u00a0 técnicas  "); expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  expect(screen.getByText("1 subestado")).toBeVisible(); expect(saveDraftPipelineAction).not.toHaveBeenCalled();
  act(() => boundary.open?.()); expect(screen.getByRole("textbox", { name: "Nombre del subestado 1" })).toHaveValue("Primera entrevista");
  expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeDisabled();
});
it("discarding Sheet edits preserves column edits, and columns saving never sends substates", async () => {
  vi.mocked(saveDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: pipelineFixture(), etag: '"pipeline-1"' });
  render(<PipelineStageEditor draftId={draftId} pipeline={pipelineFixture()} etag='"pipeline-0"' substates={substatesFixture()} substatesEtag='"substates-0"' />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la columna 2" }), { target: { value: "Filtro" } });
  act(() => boundary.open?.()); fireEvent.click(screen.getByRole("button", { name: "Agregar Primera entrevista" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "Nombre de la columna 2" })).toHaveValue("Filtro"); expect(screen.getByText("Sin subestados")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveDraftPipelineAction).toHaveBeenCalledTimes(1));
  const payload = vi.mocked(saveDraftPipelineAction).mock.calls[0][0];
  expect(Object.keys(payload.body as object).sort()).toEqual(["exit", "stages"]); expect(payload.ifMatch).toBe('"pipeline-0"'); expect(saveDraftSubstatesAction).not.toHaveBeenCalled();
});
it.each(["save", "reload"])("disables opening only during a columns %s", async mode => {
  let resolve!: (value: DraftPipelineActionResult) => void;
  const pending = new Promise<DraftPipelineActionResult>(yes => { resolve = yes; });
  vi.mocked(saveDraftPipelineAction).mockReturnValue(mode === "save" ? pending : Promise.resolve({ ok: false, reason: "version_conflict", reference: {} }));
  vi.mocked(loadDraftPipelineAction).mockReturnValue(pending);
  render(<PipelineStageEditor draftId={draftId} pipeline={pipelineFixture()} etag='"pipeline-0"' substates={substatesFixture()} substatesEtag='"substates-0"' />);
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la columna 2" }), { target: { value: "Filtro" } });
  expect(boundary.disabled).toBe(false); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  if (mode === "reload") fireEvent.click(await screen.findByRole("button", { name: "Cargar versión actual" }));
  expect(boundary.disabled).toBe(true); act(() => boundary.open?.()); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => resolve({ ok: true, pipeline: pipelineFixture(), etag: '"pipeline-1"' }));
  expect(boundary.disabled).toBe(false);
});
