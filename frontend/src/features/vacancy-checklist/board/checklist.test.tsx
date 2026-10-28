import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChecklistProvider, useBoardChecklist } from "@/features/vacancy-checklist/board/state";
import { ChecklistFit, ChecklistPanel, ChecklistReminder, ChecklistComparison, ChecklistSelection, ChecklistRetry } from "@/features/vacancy-checklist/board/ui";
import { loadChecklistAction, loadChecklistMarksAction, setChecklistMarkAction, clearChecklistMarkAction } from "../actions";
import { boardFixture } from "@/features/pipeline-movement/board-fixture";
import type { Checklist, Mark } from "../model";
vi.mock("../actions", () => ({ loadChecklistAction: vi.fn(), loadChecklistMarksAction: vi.fn(), setChecklistMarkAction: vi.fn(), clearChecklistMarkAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const item = boardFixture().participations[0];
const criterion = { id: "criterion", label: "Entrevista", importance: "required", kind: "manual", params: {} } as const;
const checklist: Checklist = { version: "1", criteria: [criterion], reminder_stage_ids: ["target"] };
const mark: Mark = { participation_id: item.id, criterion_id: criterion.id, verdict: "met", note: "Observación", marked_by: { id: "actor", full_name: "Laura" }, marked_at: "2026-10-28T12:00:00Z" };
function Harness({ target = "target" }: { target?: string }) {
  const state = useBoardChecklist();
  return <><p>Tablero disponible</p><ChecklistRetry /><ChecklistFit item={item} /><ChecklistPanel item={item} /><ChecklistReminder item={item} target={target} /><button onClick={() => move()}>Mover</button><ChecklistSelection item={item} /><ChecklistSelection item={{ ...item, id: "second", candidate: { ...item.candidate, full_name: "Otro" } }} /><ChecklistComparison vacancyId="vacancy" /><span>{state?.marks.length}</span></>;
}
const move = vi.fn();
const mount = (target?: string) => render(<ChecklistProvider vacancyId="vacancy"><Harness target={target} /></ChecklistProvider>);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: checklist });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [] } });
  vi.mocked(setChecklistMarkAction).mockResolvedValue({ ok: true, data: mark });
  vi.mocked(clearChecklistMarkAction).mockResolvedValue({ ok: true, data: null });
});
afterEach(cleanup);
it("does not obstruct or decorate a board with an empty checklist", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [] } });
  mount();
  await waitFor(() => expect(loadChecklistMarksAction).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Tablero disponible")).toBeVisible();
  expect(screen.queryByText(/Obligatorios/)).not.toBeInTheDocument();
  expect(screen.queryByText("Antes de mover")).not.toBeInTheDocument();
});
it("shows fit, unknown result and source, saves a note, clears to automatic", async () => {
  mount("other");
  expect(await screen.findByText("Obligatorios 0/1 · 1 sin evaluar")).toBeVisible();
  expect(screen.getByText("sin evaluar")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Nota de Entrevista"), { target: { value: "Observación" } });
  fireEvent.click(screen.getByRole("button", { name: "Marcar cumple: Entrevista" }));
  await waitFor(() => expect(setChecklistMarkAction).toHaveBeenCalledWith(expect.objectContaining({ body: { verdict: "met", note: "Observación" } })));
  expect(await screen.findByText(/reclutador · Laura/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Quitar marca: Entrevista" }));
  await waitFor(() => expect(clearChecklistMarkAction).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("sin evaluar")).toBeVisible();
});
it("rejects notes over 500 code points without writing", async () => {
  mount("other");
  const field = await screen.findByLabelText("Nota de Entrevista");
  fireEvent.change(field, { target: { value: "a".repeat(501) } });
  expect(screen.getByText("La nota no puede superar 500 caracteres.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toBeDisabled();
  expect(setChecklistMarkAction).not.toHaveBeenCalled();
});
it("renders distinct automatic profile and answer sources", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [
    { id: "years", label: "Experiencia", importance: "required", kind: "min_years_experience", params: { min: "3" } },
    { id: "answer", label: "Disponibilidad", importance: "desirable", kind: "screening_answer", params: { question_id: "q", accepted_option_ids: ["yes"] } },
  ] } });
  mount("other");
  expect(await screen.findByText(/perfil/)).toBeVisible();
  expect(screen.getByText(/respuesta/)).toBeVisible();
});
it("rolls back an uncertain failure and retains the board", async () => {
  vi.mocked(setChecklistMarkAction).mockRejectedValueOnce(new Error("offline"));
  mount("other");
  fireEvent.click(await screen.findByRole("button", { name: "Marcar cumple: Entrevista" }));
  expect(await screen.findByText("No se guardó la marca. Se restauró el resultado anterior.")).toBeVisible();
  expect(screen.getByText("Obligatorios 0/1 · 1 sin evaluar")).toBeVisible();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toBeEnabled();
});
it("rolls back failed marks and disables after process_finished", async () => {
  vi.mocked(setChecklistMarkAction).mockResolvedValue({ ok: false, reason: "process_finished", reference: { status: 409, code: "process_finished" } });
  mount("other");
  fireEvent.click(await screen.findByRole("button", { name: "Marcar no cumple: Entrevista" }));
  expect(await screen.findByText(/El proceso finalizó/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toBeDisabled();
  expect(screen.getByText("Obligatorios 0/1 · 1 sin evaluar")).toBeVisible();
});
it("never blocks a move without marks and saves inline marks", async () => {
  mount();
  expect(await screen.findByText("Antes de mover")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mover" }));
  expect(move).toHaveBeenCalledOnce();
  expect(setChecklistMarkAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Marcar cumple antes de mover: Entrevista" }));
  await waitFor(() => expect(setChecklistMarkAction).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByText("Antes de mover")).not.toBeInTheDocument());
});
it("hides reminders for other stages and links selected participation ids", async () => {
  mount("other");
  fireEvent.click(await screen.findByRole("button", { name: `Seleccionar para comparar: ${item.candidate.full_name}` }));
  expect(screen.queryByRole("link", { name: /Comparar/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar para comparar: Otro" }));
  expect(screen.getByRole("link", { name: "Comparar 2 candidatos" })).toHaveAttribute("href", `/empresa/vacantes/vacancy/pipeline/comparar?ids=${item.id},second`);
  expect(screen.queryByText("Antes de mover")).not.toBeInTheDocument();
});
it("offers one quiet read retry after load failure", async () => {
  vi.mocked(loadChecklistAction).mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar checklist" }));
  expect(await screen.findByText(/Obligatorios/)).toBeVisible();
});
