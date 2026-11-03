import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { loadHistoryAction, loadParticipationAction, loadPlacementCreditsAction, correctPlacementCreditAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import { id } from "./test-fixtures";
import type { ParticipationDetail, PlacementCredit } from "./model";
vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), loadPlacementCreditsAction: vi.fn(), correctPlacementCreditAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ data: { items: [] } }) }));
const credit: PlacementCredit = { id: id(90), status: "active", team_mode: "with_responsible", hired_at: "2026-11-03T12:00:00Z", hired_by: { id: id(91), name: "Test User" }, exit_reason: null, recipients: [
  { user_id: id(92), name: "Ana López", kind: "direct" }, { user_id: id(93), name: "Diego Hernández", kind: "participant" }, { user_id: id(94), name: "Mariana Ruiz", kind: "shared" },
] };
function setup(patch: Partial<ParticipationDetail> = {}) {
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), placement_credit: credit, can: { void_credit: false, restore_credit: false }, ...patch } });
  const board = boardFixture();
  return render(<CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={() => {}} />);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  vi.mocked(loadPlacementCreditsAction).mockResolvedValue({ ok: true, data: { items: [credit] } });
});
afterEach(cleanup);
it("omits the block and its extra request without a credit, preserving the summary", async () => {
  setup({ placement_credit: null });
  expect(await screen.findByRole("region", { name: "Contacto" })).toBeVisible();
  expect(screen.queryByText("Crédito del placement")).not.toBeInTheDocument();
  expect(loadPlacementCreditsAction).not.toHaveBeenCalled();
});
it.each([["active", "Activo", null], ["did_not_hold", "No se sostuvo", "candidate_left"], ["voided", "Anulado", "moved_by_mistake"]] as const)("renders %s, frozen team and all recipient kinds without nested cards", async (status, label, exit_reason) => {
  setup({ placement_credit: { ...credit, status, exit_reason } });
  const block = await screen.findByRole("region", { name: "Crédito del placement" });
  expect(within(block).getByText(label)).toHaveAttribute("data-slot", "badge");
  expect(block).toHaveTextContent("Colocado el 3 nov 2026 por Test User · Con responsable");
  for (const name of ["Ana López", "Diego Hernández", "Mariana Ruiz", "Crédito directo", "Participó", "Crédito compartido"]) expect(within(block).getByText(name)).toBeVisible();
  // Direct credit first, then shared, then participants (browser review), whatever the backend order.
  expect(Array.from(block.querySelectorAll('[data-slot="avatar-fallback"]')).map(el => el.textContent)).toEqual(["AL", "MR", "DH"]);
  expect(block.querySelector('[data-slot="card"]')).toBeNull();
  if (exit_reason) expect(within(block).getByText(exit_reason === "candidate_left" ? "El candidato se fue" : "Se movió por error")).toBeVisible();
  expect(within(block).queryByRole("button", { name: /crédito/ })).not.toBeInTheDocument();
});
it("shows shared mode and at most three previous credits, excluding the latest", async () => {
  vi.mocked(loadPlacementCreditsAction).mockResolvedValue({ ok: true, data: { items: [credit, ...[1, 2, 3, 4].map(n => ({ ...credit, id: id(n), status: "voided" as const }))] } });
  setup({ placement_credit: { ...credit, team_mode: "shared" } });
  const list = await screen.findByRole("list", { name: "Colocaciones anteriores" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(within(list).getAllByText("Anulado")).toHaveLength(3);
  expect(screen.getByText(/Equipo sin responsable/)).toBeVisible();
  expect(loadPlacementCreditsAction).toHaveBeenCalledWith(vacancyId, "person");
});
it.each(["void", "restore"] as const)("%s is only capability-driven, asks confirmation and re-reads the actual status", async action => {
  setup({ can: { void_credit: action === "void", restore_credit: action === "restore" } });
  const label = action === "void" ? "Anular crédito" : "Restaurar crédito";
  fireEvent.click(await screen.findByRole("button", { name: label }));
  const dialog = await screen.findByRole("alertdialog");
  expect(correctPlacementCreditAction).not.toHaveBeenCalled();
  expect(dialog.querySelector('[data-slot="alert-dialog-media"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
  if (action === "restore") expect(dialog).toHaveTextContent('Si su colocación ya terminó, vuelve como "No se sostuvo".');
  const updated: PlacementCredit = { ...credit, status: action === "void" ? "voided" : "did_not_hold", exit_reason: "candidate_left" };
  vi.mocked(correctPlacementCreditAction).mockResolvedValue({ ok: true, data: updated });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), placement_credit: updated, can: { void_credit: false, restore_credit: false } } });
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  await waitFor(() => expect(loadParticipationAction).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(action === "void" ? "Anulado" : "No se sostuvo")).toBeVisible();
  expect(correctPlacementCreditAction).toHaveBeenCalledTimes(1);
  expect(correctPlacementCreditAction).toHaveBeenCalledWith(expect.objectContaining({ vacancyId, participationId: "person", creditId: credit.id, action, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
});
it("cancel does not write; uncertain retries reuse the same UUID until a definitive answer", async () => {
  setup({ can: { void_credit: true, restore_credit: false } });
  fireEvent.click(await screen.findByRole("button", { name: "Anular crédito" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
  expect(correctPlacementCreditAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Anular crédito" }));
  vi.mocked(correctPlacementCreditAction).mockResolvedValue({ ok: false, reason: "uncertain", reference: {} });
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Anular crédito" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Anular crédito" }));
  await waitFor(() => expect(correctPlacementCreditAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(correctPlacementCreditAction).mock.calls[0]).toEqual(vi.mocked(correctPlacementCreditAction).mock.calls[1]);
});
it.each([["credit_status_unchanged", "El crédito ya estaba en ese estado."], ["forbidden", "No tienes permiso para esta acción."], ["team_access_ended", "Ya no formas parte del equipo de esta vacante"]] as const)("maps %s into existing feedback/access handling", async (reason, message) => {
  setup({ can: { void_credit: true, restore_credit: false } });
  vi.mocked(correctPlacementCreditAction).mockResolvedValue({ ok: false, reason, reference: { status: reason === "forbidden" ? 403 : reason === "team_access_ended" ? 404 : 409 } });
  fireEvent.click(await screen.findByRole("button", { name: "Anular crédito" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Anular crédito" }));
  expect(await screen.findByText(message)).toBeVisible();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  expect(correctPlacementCreditAction).toHaveBeenCalledTimes(1);
});
