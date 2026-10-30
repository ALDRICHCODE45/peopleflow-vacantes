import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChecklistProvider, useBoardChecklist } from "@/features/vacancy-checklist/board/state";
import { ChecklistFitSummary, ChecklistFit, ChecklistPanel, ChecklistReminder, ChecklistComparison, ChecklistSelection, ChecklistRetry } from "@/features/vacancy-checklist/board/ui";
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
  return <><p>Tablero disponible</p><ChecklistRetry /><ChecklistFit item={item} /><ChecklistPanel item={item} /><ChecklistReminder item={item} target={target} onReview={review} /><button onClick={() => move()}>Mover</button><ChecklistSelection item={item} /><ChecklistSelection item={{ ...item, id: "second", candidate: { ...item.candidate, full_name: "Otro" } }} /><ChecklistComparison vacancyId="vacancy" /><span>{state?.marks.length}</span></>;
}
const move = vi.fn();
const review = vi.fn();
const mount = (target?: string) => render(<ChecklistProvider vacancyId="vacancy"><Harness target={target} /></ChecklistProvider>);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: checklist });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [] } });
  vi.mocked(setChecklistMarkAction).mockResolvedValue({ ok: true, data: mark });
  vi.mocked(clearChecklistMarkAction).mockResolvedValue({ ok: true, data: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not obstruct or decorate a board with an empty checklist", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [] } });
  mount();
  await waitFor(() => expect(loadChecklistMarksAction).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Tablero disponible")).toBeVisible();
  expect(screen.queryByText(/Obligatorios/)).not.toBeInTheDocument();
  expect(screen.queryByText("Antes de mover")).not.toBeInTheDocument();
});
it("shows compact grouped rows with collapsed notes and saves a note, clears to automatic", async () => {
  mount("other");
  expect(await screen.findByLabelText(/Ajuste al checklist/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Obligatorios" })).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Agregar nota: Entrevista" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Agregar nota: Entrevista" }));
  const field = screen.getByLabelText("Nota de Entrevista");
  fireEvent.change(field, { target: { value: "a".repeat(501) } });
  expect(screen.getByText("La nota no puede superar 500 caracteres.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toBeDisabled();
  expect(setChecklistMarkAction).not.toHaveBeenCalled();
});
it("hides unknown automatic profile and answer sources", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [
    { id: "years", label: "Experiencia", importance: "required", kind: "min_years_experience", params: { min: "3" } },
    { id: "answer", label: "Disponibilidad", importance: "desirable", kind: "screening_answer", params: { question_id: "q", accepted_option_ids: ["yes"] } },
  ] } });
  mount("other");
  await screen.findByRole("button", { name: "Marcar cumple: Experiencia" });
  expect(screen.queryByText(/perfil|respuesta/)).not.toBeInTheDocument();
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
it("never blocks a move and sends the recruiter to the sheet instead of marking inline", async () => {
  mount();
  const reminder = await screen.findByRole("region", { name: "Antes de mover" });
  expect(within(reminder).getByText("1 obligatorio sin evaluar")).toBeVisible();
  expect(within(reminder).getByText("Entrevista.")).toBeVisible();
  expect(within(reminder).getByText("Puedes mover sin marcarlo.")).toBeVisible();
  expect(within(reminder).queryAllByRole("button", { name: /Marcar/ })).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Mover" }));
  expect(move).toHaveBeenCalledOnce();
  fireEvent.click(within(reminder).getByRole("button", { name: "Revisar en la ficha" }));
  expect(review).toHaveBeenCalledOnce();
  expect(setChecklistMarkAction).not.toHaveBeenCalled();
});
it("disappears once the pending required criterion is marked in the sheet", async () => {
  mount();
  await screen.findByRole("region", { name: "Antes de mover" });
  fireEvent.click(screen.getByRole("button", { name: "Marcar cumple: Entrevista" }));
  await waitFor(() => expect(setChecklistMarkAction).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole("region", { name: "Antes de mover" })).not.toBeInTheDocument());
});
it("hides reminders for other stages and opts into comparison selection, cancel clears it", async () => {
  mount("other");
  await screen.findByLabelText(/Ajuste al checklist/);
  expect(screen.queryByRole("checkbox", { name: /Seleccionar para comparar/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Comparar candidatos" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar para comparar: ${item.candidate.full_name}` }));
  expect(screen.queryByRole("link", { name: /Comparar/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar para comparar: Otro" }));
  expect(screen.getByRole("link", { name: "Comparar (2)" })).toHaveAttribute("href", `/empresa/vacantes/vacancy/pipeline/comparar?ids=${item.id},second`);
  expect(screen.queryByText("Antes de mover")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Comparar candidatos" }));
  expect(screen.getByRole("button", { name: "Comparar (0)" })).toBeDisabled();
});
it("limits selection to five, still allows deselection and does not write marks", async () => {
  render(<ChecklistProvider vacancyId="vacancy">{Array.from({ length: 6 }, (_, n) => <ChecklistSelection key={n} item={{ ...item, id: `p${n}`, candidate: { ...item.candidate, full_name: `Persona ${n}` } }} />)}<ChecklistComparison vacancyId="vacancy" /></ChecklistProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Comparar candidatos" }));
  for (let n = 0; n < 5; n++) fireEvent.click(screen.getByRole("checkbox", { name: `Seleccionar para comparar: Persona ${n}` }));
  expect(screen.getByRole("link", { name: "Comparar (5)" })).toHaveAttribute("href", "/empresa/vacantes/vacancy/pipeline/comparar?ids=p0,p1,p2,p3,p4");
  expect(screen.getByRole("checkbox", { name: "Seleccionar para comparar: Persona 5" })).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar para comparar: Persona 0" }));
  expect(screen.getByRole("link", { name: "Comparar (4)" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Seleccionar para comparar: Persona 5" })).not.toHaveAttribute("aria-disabled", "true");
  expect(setChecklistMarkAction).not.toHaveBeenCalled();
});
it("summarizes many pending required criteria in one notice that never overflows", async () => {
  const long = "Mínimo 3 años de experiencia comprobable en desarrollo Backend utilizando Go o Node.js/TypeScript.";
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [{ ...criterion, id: "long", label: long }, ...Array.from({ length: 10 }, (_, n) => ({ ...criterion, id: `c${n}`, label: `Criterio ${n}` }))] } });
  mount();
  const reminder = await screen.findByRole("region", { name: "Antes de mover" });
  expect(within(reminder).getByText("11 obligatorios sin evaluar")).toBeVisible();
  expect(within(reminder).getByText("Puedes mover sin marcarlos.")).toBeVisible();
  const names = within(reminder).getByText(`${long}, Criterio 0, Criterio 1 y 8 más.`);
  // One notice, not a row per criterion: long labels wrap and clamp inside the dialog width.
  expect(names).toHaveClass("line-clamp-2", "break-words");
  expect(names.closest('[data-slot="item-content"]')).toHaveClass("min-w-0");
  const notice = reminder.querySelectorAll('[data-slot="item"]');
  expect(notice).toHaveLength(1);
  // Dark mode: an outline item, never a muted surface that vanishes on the card (§13.1).
  expect(notice[0]).toHaveAttribute("data-variant", "outline");
  expect(within(reminder).queryAllByRole("button", { name: /Marcar/ })).toHaveLength(0);
});
it.each(["light", "dark"])("keeps compact fit and notes flexible at 256px card / 390px sheet widths in %s theme (structural)", async theme => {
  document.documentElement.className = theme;
  const { container } = mount("other");
  const fit = await screen.findByLabelText(/Ajuste al checklist/);
  expect(fit).toHaveClass("min-w-0");
  expect(within(fit).getByText("0/1 obligatorios")).toBeVisible();
  // A data line, not a status pill (§16): no badge on the card.
  expect(fit.querySelector('[data-slot="badge"]')).toBeNull();
  const panel = screen.getByRole("region", { name: "Checklist del candidato" });
  expect(panel).toHaveClass("min-w-0");
  expect(panel.querySelector('[data-slot="item-title"]')).toHaveClass("line-clamp-none");
  expect(panel.querySelector('[data-slot="item-title"] span')).toHaveClass("line-clamp-2", "break-words");
  expect(panel.querySelector('[data-pf-action-status-slot]')).toBeNull();
  expect(container.innerHTML).not.toMatch(/(?:bg|text)-(?:red|green|blue)-\d/);
  document.documentElement.className = "";
});
it("draws one bar segment per required criterion, ordered cumple, no cumple, sin evaluar", async () => {
  const required = ["a", "b", "c"].map(id => ({ ...criterion, id, label: `Criterio ${id}` }));
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [...required, { ...criterion, id: "d", label: "Deseable", importance: "desirable" }] } });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [{ ...mark, criterion_id: "c", verdict: "met" }, { ...mark, criterion_id: "a", verdict: "not_met" }] } });
  mount("other");
  const fit = await screen.findByLabelText(/Ajuste al checklist/);
  await waitFor(() => expect(within(fit).getByText("1/3 obligatorios")).toBeVisible());
  expect([...fit.querySelectorAll("[data-segment]")].map(segment => segment.getAttribute("data-segment"))).toEqual(["met", "not_met", "unknown"]);
  expect(fit).toHaveAccessibleName("Ajuste al checklist: Obligatorios 1/3 · Deseables 0/1 · 2 sin evaluar");
});
it("keeps ChecklistFit markup identical to the context-free summary presentation", async () => {
  const { container } = render(<><ChecklistProvider vacancyId="vacancy"><ChecklistFit item={item} /></ChecklistProvider><section data-reference><ChecklistFitSummary fit={{ required: { met: 0, not_met: 0, unknown: 1 }, desirable: { met: 0, not_met: 0, unknown: 0 } }} /></section></>);
  await waitFor(() => expect(screen.getAllByLabelText(/Ajuste al checklist/)).toHaveLength(2));
  const fits = screen.getAllByLabelText(/Ajuste al checklist/);
  expect(fits[0].innerHTML).toBe(fits[1].innerHTML);
  expect(fits[0].className).toBe(fits[1].className);
  expect(container.querySelectorAll('[data-segment="unknown"]')).toHaveLength(2);
});
it("keeps the bar to three proportional segments past 24 required criteria", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: Array.from({ length: 30 }, (_, n) => ({ ...criterion, id: `c${n}`, label: `Criterio ${n}` })) } });
  mount("other");
  const fit = await screen.findByLabelText(/Ajuste al checklist/);
  expect(within(fit).getByText("0/30 obligatorios")).toBeVisible();
  const segments = [...fit.querySelectorAll<HTMLElement>("[data-segment]")];
  expect(segments.map(segment => segment.getAttribute("data-segment"))).toEqual(["unknown"]);
  expect(segments[0].style.flexGrow).toBe("30");
});
it("retains known automatic sources and existing notes behind Editar nota", async () => {
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, data: { ...checklist, criteria: [criterion, { id: "skill", label: "SQL", importance: "desirable", kind: "skill", params: { name: "SQL" } }] } });
  vi.mocked(loadChecklistMarksAction).mockResolvedValue({ ok: true, data: { items: [mark] } });
  mount("other");
  expect(await screen.findByText("Observación")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Marcar cumple: Entrevista" })).toHaveAttribute("aria-pressed", "true");
  const edit = screen.getByRole("button", { name: "Editar nota: Entrevista" });
  expect(edit).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(edit);
  expect(screen.getByLabelText("Nota de Entrevista")).toHaveValue("Observación");
});
it("offers one quiet read retry after load failure", async () => {
  vi.mocked(loadChecklistAction).mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar checklist" }));
  expect(await screen.findByLabelText(/Ajuste al checklist/)).toBeVisible();
});
