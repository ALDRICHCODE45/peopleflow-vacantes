import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftDeliveryAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { pipelineFixture } from "../stage-config/test-fixture";
import { deliveryFixture } from "../delivery-config/test-fixture";
import { VacancyDeliveryModule } from "./delivery-module";
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn(), saveDraftDeliveryAction: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const success = (): DraftDeliveryActionResult => ({ ok: true, delivery: deliveryFixture(), etag: '"delivery"' });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, pipeline: pipelineFixture(), etag: '"pipeline"' }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(success()); });
afterEach(cleanup);
it("loads both reads in parallel, withholding the editor behind its skeleton", async () => {
  let resolve!: (result: DraftDeliveryActionResult) => void; vi.mocked(loadDraftDeliveryAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = render(<VacancyDeliveryModule draftId={id} />); expect(loadDraftPipelineAction).toHaveBeenCalledExactlyOnceWith(id); expect(loadDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando entrega"); expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await act(async () => resolve(success())); expect(screen.getByRole("heading", { level: 3, name: "Entrega" })).toBeVisible(); expect(container.querySelector("header")).toBeNull();
});
for (const resource of ["pipeline", "delivery"] as const) it.each(["unauthenticated", "not_found", "no_response", "server_error", "validation_error"] as const)(`${resource} failure %s reuses the existing error/retry state`, async reason => {
  vi.mocked(resource === "pipeline" ? loadDraftPipelineAction : loadDraftDeliveryAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  render(<VacancyDeliveryModule draftId={id} />); expect(await screen.findByRole("heading", { name: reason === "unauthenticated" ? "Tu sesión expiró" : reason === "not_found" ? "No encontramos este borrador" : reason === "no_response" ? "No hubo respuesta del servidor" : reason === "server_error" ? "El servidor tuvo un problema" : "No pudimos confirmar el resultado" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); await screen.findByRole("heading", { name: "Entrega" }); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(2); expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(2);
});
it("handles rejected reads and ignores late reads for a previous draft", async () => {
  let resolve!: (result: DraftDeliveryActionResult) => void; vi.mocked(loadDraftDeliveryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockRejectedValueOnce(new Error("unsafe"));
  const { rerender } = render(<VacancyDeliveryModule draftId={id} />); rerender(<VacancyDeliveryModule draftId="223e4567-e89b-42d3-a456-426614174000" />); await screen.findByRole("heading", { name: "No hubo respuesta del servidor" }); await act(async () => resolve(success())); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
