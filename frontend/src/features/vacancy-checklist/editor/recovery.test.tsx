import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChecklistEditor } from "./editor";
import { fieldErrors } from "./feedback";
import { loadChecklistAction, saveChecklistAction } from "../actions";
import type { Checklist, ChecklistBody, Criterion } from "../model";
vi.mock("../actions", () => ({ loadChecklistAction: vi.fn(), saveChecklistAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const id = "123e4567-e89b-42d3-a456-426614174000";
const otherId = "223e4567-e89b-42d3-a456-426614174000";
const baseline: Checklist = { version: "1", criteria: [{ id, kind: "manual", params: {}, label: "Disponibilidad", importance: "required" }], reminder_stage_ids: [] };
const stages = [{ id: otherId, kind: "custom" as const, name: "Entrevista" }];
function setup(checklist = baseline) { render(<ChecklistEditor draftId={id} checklist={checklist} etag={'"loaded"'} stages={stages} fields={{}} questions={[]} />); }
function change() { fireEvent.click(screen.getByRole("checkbox", { name: "Entrevista" })); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" })); }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("recognizes an uncertain save that actually succeeded, adopts its ETag, and never repeats it", async () => {
  vi.mocked(saveChecklistAction).mockImplementation(async input => {
    vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, etag: '"checked"', data: { ...(input.body as ChecklistBody), version: "2" } });
    return { ok: false, reason: "no_response", reference: {} };
  });
  setup(); change(); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  expect(await screen.findByText("Checklist guardado")).toBeVisible();
  expect(saveChecklistAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
});
it("unlocks a safely retryable save only after an unchanged baseline is read", async () => {
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, etag: '"loaded"', data: baseline });
  setup(); change();
  expect(await screen.findByRole("button", { name: "Comprobar" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
  expect(await screen.findByText("No se guardó el checklist")).toBeVisible();
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "Entrevista" })).toBeChecked();
  expect(saveChecklistAction).toHaveBeenCalledTimes(1);
});
it("conflict recovery reads once and replaces local work only on explicit reload", async () => {
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: {} });
  vi.mocked(loadChecklistAction).mockResolvedValue({ ok: true, etag: '"fresh"', data: { ...baseline, version: "2", criteria: [{ ...baseline.criteria[0], label: "Actualizado por tu equipo" }] } });
  setup(); change();
  expect(await screen.findByText("Esto cambió en otro lugar")).toBeVisible();
  expect(screen.getByText("Disponibilidad")).toBeVisible();
  expect(loadChecklistAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cargar versión actual" }));
  expect(await screen.findByText("Actualizado por tu equipo")).toBeVisible();
  expect(loadChecklistAction).toHaveBeenCalledTimes(1);
  expect(saveChecklistAction).toHaveBeenCalledTimes(1);
});
it("keeps all four rows and attaches a stale question to row four, then focuses its edit control", async () => {
  const criteria: Criterion[] = Array.from({ length: 4 }, (_, index) => ({ id: `123e4567-e89b-42d3-a456-42661417400${index}`, label: `Criterio ${index + 1}`, kind: "manual", params: {}, importance: "required" }));
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: {}, fields: [{ field: "criteria[3].params.question_id", code: "invalid" }] });
  setup({ ...baseline, criteria }); change();
  const message = await screen.findByText("La pregunta ya no existe; quítala o cámbiala");
  expect(within(screen.getAllByRole("listitem")[3]).getByText(message.textContent!)).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar Criterio 4" })).toHaveFocus());
});
it("distinguishes duplicated questions from deleted questions", () => {
  expect(fieldErrors([{ field: "criteria[3].params.question_id", code: "duplicate" }]).rows[3]).toBe("Este criterio está repetido; quítalo o cámbialo");
});
