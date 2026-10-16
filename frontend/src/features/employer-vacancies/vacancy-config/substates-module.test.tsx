import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftPipelineAction, type DraftPipelineActionFailure, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import { pipelineFixture } from "../stage-config/test-fixture";
import { substatesFixture } from "../substates-config/test-fixture";
import { VacancySubstatesModule } from "./substates-module";
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const pipelineSuccess = (): DraftPipelineActionResult => { const pipeline = pipelineFixture(); pipeline.stages.find(entry => entry.kind === "in_process")!.name = "Entrevistas"; return { ok: true, pipeline, etag: '"columns"' }; };
const success = (): DraftSubstatesActionResult => ({ ok: true, catalog: substatesFixture(), etag: '"substates"' });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadDraftPipelineAction).mockResolvedValue(pipelineSuccess()); vi.mocked(loadDraftSubstatesAction).mockResolvedValue(success()); });
afterEach(cleanup);
it("starts both reads in parallel and waits for both with one contextual skeleton", async () => {
  let pipelineResolve!: (value: DraftPipelineActionResult) => void; let catalogResolve!: (value: DraftSubstatesActionResult) => void;
  vi.mocked(loadDraftPipelineAction).mockReturnValueOnce(new Promise(yes => { pipelineResolve = yes; }));
  vi.mocked(loadDraftSubstatesAction).mockReturnValueOnce(new Promise(yes => { catalogResolve = yes; }));
  const { container } = render(<VacancySubstatesModule draftId={id} />);
  expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(id); expect(loadDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(screen.getAllByRole("status")).toHaveLength(1); expect(screen.getByRole("status")).toHaveTextContent("Cargando subestados");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull(); expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(8);
  await act(async () => catalogResolve(success())); expect(screen.queryByRole("heading", { name: "Subestados de Entrevistas" })).not.toBeInTheDocument();
  await act(async () => pipelineResolve(pipelineSuccess())); expect(screen.getByRole("heading", { level: 3, name: "Subestados de Entrevistas" })).toBeVisible();
});
it("uses the semantic in_process name and mounts only the substate editor", async () => {
  const { container } = render(<VacancySubstatesModule draftId={id} />);
  await screen.findByRole("heading", { name: "Subestados de Entrevistas" }); expect(container.querySelector("header")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Columnas del pipeline" })).not.toBeInTheDocument();
});
for (const source of ["pipeline", "catalog"] as const) it.each([
  ["unauthenticated", "Tu sesión expiró"], ["forbidden", "No tienes permiso para abrirlo"], ["not_found", "No encontramos este borrador"],
  ["company_inactive", "Falta configurar tu empresa"], ["company_not_active", "Falta configurar tu empresa"], ["no_response", "No hubo respuesta del servidor"],
  ["server_error", "El servidor tuvo un problema"], ["validation_error", "No pudimos confirmar el resultado"], ["unrecognized_response", "No pudimos confirmar el resultado"],
])(`${source} %s maps to Empty with retry`, async (reason, title) => {
  const failure = { ok: false, reason: reason as DraftPipelineActionFailure["reason"], reference: {} } as const;
  if (source === "pipeline") vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce(failure); else vi.mocked(loadDraftSubstatesAction).mockResolvedValueOnce(failure);
  render(<VacancySubstatesModule draftId={id} />); expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); await screen.findByRole("heading", { name: "Subestados de Entrevistas" });
  expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2); expect(loadDraftSubstatesAction).toHaveBeenCalledTimes(2);
});
it.each(["pipeline", "catalog"] as const)("handles rejected %s reads", async source => {
  if (source === "pipeline") vi.mocked(loadDraftPipelineAction).mockRejectedValueOnce(new Error("unsafe")); else vi.mocked(loadDraftSubstatesAction).mockRejectedValueOnce(new Error("unsafe"));
  render(<VacancySubstatesModule draftId={id} />); expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
it("rejects a pipeline without an in_process name rather than inventing one", async () => {
  const result = pipelineSuccess(); if (!result.ok) throw new Error("fixture"); result.pipeline.stages = result.pipeline.stages.filter(entry => entry.kind !== "in_process");
  vi.mocked(loadDraftPipelineAction).mockResolvedValue(result); render(<VacancySubstatesModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: "No pudimos confirmar el resultado" })).toBeVisible();
});
it("ignores late reads after switching vacancy", async () => {
  let resolve!: (value: DraftSubstatesActionResult) => void;
  vi.mocked(loadDraftSubstatesAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: false, reason: "not_found", reference: {} });
  const { rerender } = render(<VacancySubstatesModule draftId={id} />); rerender(<VacancySubstatesModule draftId="223e4567-e89b-42d3-a456-426614174000" />);
  await screen.findByRole("heading", { name: "No encontramos este borrador" }); await act(async () => resolve(success()));
  expect(screen.queryByRole("heading", { name: "Subestados de Entrevistas" })).not.toBeInTheDocument();
});
