import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftPipelineAction, type DraftPipelineActionFailure, type DraftPipelineActionResult } from "@/features/jobs/drafts/pipeline/actions";
import { pipelineFixture } from "../stage-config/test-fixture";
import { loadDraftSubstatesAction, type DraftSubstatesActionResult } from "@/features/jobs/drafts/pipeline/substates-actions";
import { substatesFixture } from "../substates-config/test-fixture";
import { VacancyColumnsModule } from "./columns-module";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { deliveryFixture } from "../delivery-config/test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const catalogSuccess = (): DraftSubstatesActionResult => ({ ok: true, catalog: substatesFixture(), etag: '"substates-0"' });
const success = () => ({ ok: true, pipeline: pipelineFixture(), etag: '"pipeline-0"' } as const);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadDraftPipelineAction).mockResolvedValue(success()); vi.mocked(loadDraftSubstatesAction).mockResolvedValue(catalogSuccess()); vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), cutoffStageId: pipelineFixture().stages[1].id }, etag: '"delivery"' }); });
afterEach(cleanup);
it("reserves the editor composition during its first load", async () => {
  let resolve!: (value: DraftPipelineActionResult) => void;
  vi.mocked(loadDraftPipelineAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { container } = render(<VacancyColumnsModule draftId={id} />);
  expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(loadDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(loadDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando pipeline");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(10);
  await act(async () => resolve(success()));
});
it("renders the real column editor without a second header", async () => {
  const { container } = render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { level: 3, name: "Columnas del pipeline" })).toBeVisible();
  expect(screen.getAllByRole("textbox")).toHaveLength(6);
  expect(screen.getByText("Sin subestados").closest('[data-slot="badge"]')).toBeNull();
  expect(screen.getByText("Corte de entrega")).toHaveAttribute("data-variant", "info");
  expect(container.querySelector("header")).toBeNull();
});
it.each([
  ["unauthenticated", "Tu sesión expiró"], ["not_found", "No encontramos este borrador"],
  ["forbidden", "No tienes permiso para abrirlo"], ["company_inactive", "Falta configurar tu empresa"],
  ["company_not_active", "Falta configurar tu empresa"], ["server_error", "El servidor tuvo un problema"],
  ["no_response", "No hubo respuesta del servidor"], ["validation_error", "No pudimos confirmar el resultado"],
  ["unrecognized_response", "No pudimos confirmar el resultado"], ["future_reason", "No pudimos confirmar el resultado"],
])("maps pipeline load %s to the Empty error with explicit retry", async (reason, title) => {
  vi.mocked(loadDraftPipelineAction).mockResolvedValueOnce({ ok: false, reason: reason as Exclude<DraftPipelineActionFailure["reason"], "process_finished">, reference: {} });
  render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Columnas del pipeline" });
  expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2);
});
it.each(["server_error", "version_conflict", "not_found"] as const)("shows the existing error state if catalog load fails with %s and retries both reads", async reason => {
  vi.mocked(loadDraftSubstatesAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: reason === "server_error" ? "El servidor tuvo un problema" : reason === "not_found" ? "No encontramos este borrador" : "No pudimos confirmar el resultado" })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Columnas del pipeline" });
  expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2); expect(loadDraftSubstatesAction).toHaveBeenCalledTimes(2);
});
it("waits for delivery before exposing the editor and retries all three reads after delivery failure", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadDraftDeliveryAction>>) => void;
  vi.mocked(loadDraftDeliveryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<VacancyColumnsModule draftId={id} />);
  await act(async () => {}); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await act(async () => resolve({ ok: false, reason: "server_error", reference: { status: 500 } }));
  expect(screen.getByRole("heading", { name: "El servidor tuvo un problema" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("heading", { name: "Columnas del pipeline" });
  expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2); expect(loadDraftSubstatesAction).toHaveBeenCalledTimes(2); expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(2);
});
it("handles a rejected delivery read safely", async () => {
  vi.mocked(loadDraftDeliveryAction).mockRejectedValueOnce(new Error("unsafe"));
  render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("waits for the catalog before exposing the editor, loading both resources in parallel", async () => {
  let resolve!: (value: DraftSubstatesActionResult) => void;
  vi.mocked(loadDraftSubstatesAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<VacancyColumnsModule draftId={id} />);
  expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(id); expect(loadDraftSubstatesAction).toHaveBeenCalledExactlyOnceWith(id);
  await act(async () => {});
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await act(async () => resolve(catalogSuccess()));
  expect(screen.getByText("Sin subestados")).toBeVisible();
});
it("handles rejected catalog reads safely", async () => {
  vi.mocked(loadDraftSubstatesAction).mockRejectedValueOnce(new Error("network"));
  render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
it("handles rejected reads safely", async () => {
  vi.mocked(loadDraftPipelineAction).mockRejectedValueOnce(new Error("network"));
  render(<VacancyColumnsModule draftId={id} />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
it("does not expose a stale configuration after changing vacancy", async () => {
  let resolve!: (value: DraftPipelineActionResult) => void;
  vi.mocked(loadDraftPipelineAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: false, reason: "not_found", reference: {} });
  const { rerender } = render(<VacancyColumnsModule draftId={id} />);
  rerender(<VacancyColumnsModule draftId="223e4567-e89b-42d3-a456-426614174000" />);
  await screen.findByRole("heading", { name: "No encontramos este borrador" });
  await act(async () => resolve(success()));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
