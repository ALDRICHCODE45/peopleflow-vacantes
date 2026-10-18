import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftManagementAction, type DraftManagementActionResult } from "@/features/jobs/drafts/pipeline/management-actions";
import { managementFixture } from "../management-config/test-fixture";
import { VacancyManagementModule } from "./management-module";
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn(), saveDraftManagementAction: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const success = (): DraftManagementActionResult => ({ ok: true, management: managementFixture(), etag: '"management"' });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadDraftManagementAction).mockResolvedValue(success()); });
afterEach(cleanup);
it("withholds the editor behind the two-field skeleton until the authorized read finishes", async () => {
  let resolve!: (result: DraftManagementActionResult) => void; vi.mocked(loadDraftManagementAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = render(<VacancyManagementModule draftId={id} />); expect(loadDraftManagementAction).toHaveBeenCalledExactlyOnceWith(id);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando solicitud"); expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(2); expect(container.querySelectorAll('[data-slot="card-footer"] [data-slot="skeleton"]')).toHaveLength(2); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Solicitud")).toHaveAttribute("aria-busy", "true");
  await act(async () => resolve(success())); expect(screen.getByRole("heading", { level: 3, name: "Solicitud" })).toBeVisible(); expect(container.querySelector("header")).toBeNull();
});
it.each(["unauthenticated", "not_found", "no_response", "server_error", "validation_error"] as const)("failure %s reuses the existing error/retry state", async reason => {
  vi.mocked(loadDraftManagementAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  render(<VacancyManagementModule draftId={id} />); expect(await screen.findByRole("heading", { name: reason === "unauthenticated" ? "Tu sesión expiró" : reason === "not_found" ? "No encontramos este borrador" : reason === "no_response" ? "No hubo respuesta del servidor" : reason === "server_error" ? "El servidor tuvo un problema" : "No pudimos confirmar el resultado" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); await screen.findByRole("heading", { name: "Solicitud" }); expect(loadDraftManagementAction).toHaveBeenCalledTimes(2);
});
it("handles rejected reads and ignores late reads for a previous draft", async () => {
  let resolve!: (result: DraftManagementActionResult) => void; vi.mocked(loadDraftManagementAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockRejectedValueOnce(new Error("unsafe"));
  const { rerender } = render(<VacancyManagementModule draftId={id} />); rerender(<VacancyManagementModule draftId="223e4567-e89b-42d3-a456-426614174000" />); await screen.findByRole("heading", { name: "No hubo respuesta del servidor" }); await act(async () => resolve(success())); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
