import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VacancyPsychometricsModule } from "./index";
import { loadProfileAction, saveProfileAction } from "../actions";
import { COMPETENCY_IDS, type Profile } from "../model";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const profile: Profile = { version: "0", enabled: false, confirmed: false, confirmed_at: null, test: "ipip60-mx", competencies: COMPETENCY_IDS.map(competency_id => ({ competency_id, importance: "importance.no_relevante", desired_band: null, rationale: null, task: null })), auto_send_stage_ids: [], expires_in_days: 7 };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: profile, etag: '"profile"' });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, etag: '"pipeline"', pipeline: { version: "0", structure_locked: false, stages: [{ id: "current", kind: "new", name: "Nuevos" }], retired: [{ id: "old", kind: "custom", name: "Retirada" }], exit: { id: "exit", kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 10, nameMaxLength: 40 } } });
});
afterEach(cleanup);
it("loads profile and current progression stages on mount, never exit or retired stages", async () => {
  const { container } = render(<VacancyPsychometricsModule draftId="vacancy" />);
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull(); expect(screen.getByRole("status")).toHaveTextContent("Cargando perfil psicométrico");
  expect(await screen.findByRole("heading", { name: "Psicometría" })).toBeVisible();
  expect(loadProfileAction).toHaveBeenCalledWith("vacancy"); expect(loadDraftPipelineAction).toHaveBeenCalledWith("vacancy");
  expect(screen.getByRole("checkbox", { name: "Nuevos" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Retirada" })).not.toBeInTheDocument(); expect(screen.queryByRole("checkbox", { name: "Descartados" })).not.toBeInTheDocument(); expect(saveProfileAction).not.toHaveBeenCalled();
});
it("uses the shared section error and retries reads only on request", async () => {
  vi.mocked(loadProfileAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }); render(<VacancyPsychometricsModule draftId="vacancy" />);
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible(); expect(saveProfileAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); expect(await screen.findByRole("heading", { name: "Psicometría" })).toBeVisible(); expect(loadProfileAction).toHaveBeenCalledTimes(2);
});
