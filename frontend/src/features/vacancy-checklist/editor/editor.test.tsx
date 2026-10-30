import type { ReactNode } from "react";
// Same positioning-only replacement as geo/location-field.test: jsdom loops on anchored portals.
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div data-slot="combobox-content">{children}</div>,
}));
// Keep the real menu items and handlers inline; floating positioning does not run in jsdom (same pattern as company-site tests).
vi.mock("@/components/ui/dropdown-menu", async importOriginal => {
  const parts = await importOriginal<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChecklistEditor } from "@/features/vacancy-checklist/editor/editor";
import { criterionActions, applyCriterionAction } from "@/features/vacancy-checklist/editor/rows";
import { loadChecklistAction, saveChecklistAction } from "../actions";
import type { Checklist, Criterion } from "../model";
vi.mock("../actions", () => ({ loadChecklistAction: vi.fn(), saveChecklistAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }] } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoPostalCode: () => ({ status: "idle" }), useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }] } }, states: { status: "success", data: { items: [{ id: "09", name: "Ciudad de México" }, { id: "15", name: "Estado de México" }] } } }) }));
// The exported commands also pin disabled bounds and identity preservation.
const id = "123e4567-e89b-42d3-a456-426614174000";
const nextId = "223e4567-e89b-42d3-a456-426614174000";
const option = "323e4567-e89b-42d3-a456-426614174000";
const manual: Criterion = { id, kind: "manual", params: {}, label: "Disponibilidad", importance: "required" };
const stages = [{ id, kind: "new" as const, name: "Nuevos" }, { id: nextId, kind: "custom" as const, name: "Entrevista" }];
const questions = [{ id, type: "single_choice_evaluated" as const, prompt: "¿Viajas?", options: [{ id: option, label: "Sí" }, { id: nextId, label: "No" }], correct_option_id: option, required: true }];
const empty: Checklist = { version: "0", criteria: [], reminder_stage_ids: [] };
function editor(checklist = empty) { return render(<ChecklistEditor draftId={id} checklist={checklist} etag={'"loaded"'} stages={stages} fields={{ min_years_of_experience: "3", skills: ["SQL"] }} questions={questions} />); }
async function choose(label: string, text: string) {
  const control = screen.getByRole("combobox", { name: label });
  fireEvent.click(control);
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: text }));
}
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); vi.resetAllMocks(); vi.mocked(loadChecklistAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); vi.mocked(saveChecklistAction).mockImplementation(async input => ({ ok: true, etag: '"saved"', data: { ...(input.body as object), version: "1" } as Checklist })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows the nothing-selected detail beside the unchanged empty list", () => {
  editor({ ...empty, version: "1" });
  const detail = screen.getByRole("region", { name: "Detalle del criterio" });
  expect(within(detail).getByRole("heading", { name: "Selecciona un criterio para verlo aquí", level: 3 })).toBeVisible();
  expect(within(detail).getByText("Agrega un criterio en la lista para empezar. Sus datos aparecerán en este panel.")).toBeVisible();
  expect(detail.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-primary/10");
  expect(within(detail).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Agregar criterio" }));
  expect(within(detail).getByLabelText("Etiqueta")).toHaveValue("");
  expect(screen.queryByText("Selecciona un criterio para verlo aquí")).not.toBeInTheDocument();
});
it("selects rows into an inline detail and updates importance badges and counts", () => {
  editor({ ...empty, version: "1", criteria: [manual, { ...manual, id: nextId, label: "Otro" }] });
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Otro" }));
  const detail = screen.getByRole("region", { name: "Detalle del criterio" });
  expect(within(detail).getByLabelText("Etiqueta")).toHaveValue("Otro");
  fireEvent.click(within(detail).getByRole("button", { name: "Deseable" }));
  expect(within(screen.getByRole("button", { name: "Seleccionar Otro" })).getByText("Deseable")).toBeVisible();
  expect(screen.getAllByText("1 obligatorios · 1 deseables")).toHaveLength(2);
});
it("adds a selected inline draft and focuses client-invalid detail without writing", async () => {
  editor({ ...empty, version: "1", criteria: [manual] });
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
  expect(screen.getByLabelText("Etiqueta")).toHaveValue("");
  expect(screen.getByText("Criterio 2 de 2 · Manual")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Disponibilidad" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Detalle del criterio" })).toHaveFocus());
  expect(screen.getByLabelText("Etiqueta")).toHaveValue("");
  expect(saveChecklistAction).not.toHaveBeenCalled();
});
it("resolves automatic language labels without changing custom stored labels", () => {
  const language: Criterion = { ...manual, kind: "language", params: { code: "en", min_level: "C1" }, label: "Idioma en: mínimo C1" };
  editor({ ...empty, version: "1", criteria: [language, { ...language, id: nextId, label: "Inglés para ventas" }] });
  expect(screen.getByRole("button", { name: "Seleccionar Idioma: Inglés · mínimo C1" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Inglés para ventas" }));
  expect(screen.getByLabelText("Etiqueta")).toHaveValue("Inglés para ventas");
});
it("counts reminder stages in its own card", () => {
  editor();
  const reminders = screen.getByRole("region", { name: "Recordatorio al mover" });
  expect(within(reminders).getByText("1 etapa")).toBeVisible();
  fireEvent.click(within(reminders).getByRole("checkbox", { name: "Nuevos" }));
  expect(within(reminders).getByText("2 etapas")).toBeVisible();
});
it("explains the internal empty state, suggests criteria and preselects reminders only for version zero", async () => {
  editor();
  expect(screen.getByText(/interno.*nunca.*público.*automáticamente/i)).toBeVisible();
  expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Agregar criterio" }).closest('[data-slot="empty-content"]')).not.toBeNull();
  expect(screen.getByRole("checkbox", { name: "Nuevos" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Entrevista" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Entrevista" }).closest('[data-slot="checkbox-group"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Sugerir desde la vacante" }).parentElement).toHaveClass("flex-col", "sm:flex-row");
  fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" }));
  expect(screen.getByRole("button", { name: "Seleccionar Al menos 3 años de experiencia" })).toBeVisible();
  expect(screen.getByText("Habilidad: SQL")).toBeVisible();
  expect(screen.getByText("¿Viajas?")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveChecklistAction).toHaveBeenCalledWith(expect.objectContaining({ vacancyId: id, ifMatch: '"loaded"', body: expect.objectContaining({ reminder_stage_ids: [nextId] }) })));
});
it("does not preselect stages for an already saved empty checklist", () => { editor({ ...empty, version: "1" }); expect(screen.getByRole("checkbox", { name: "Entrevista" })).not.toBeChecked(); });
it.each([
  ["Años de experiencia", "min_years_experience"], ["Seniority", "seniority"], ["Estudios", "education"], ["Idioma", "language"], ["Habilidad", "skill"], ["Ubicación", "location"], ["Respuesta de filtro", "screening_answer"], ["Manual", "manual"],
])("adds %s through inline detail and sends its validated params", async (name, kind) => {
  editor(); fireEvent.click(screen.getByRole("button", { name: "Agregar criterio" }));
  await choose("Tipo de criterio", name);
  if (kind === "seniority") await choose("Niveles aceptados", "Senior");
  if (kind === "language") await choose("Idioma", "Inglés");
  if (kind === "skill") fireEvent.change(screen.getByLabelText("Habilidad"), { target: { value: "SQL" } });
  if (kind === "location") { await choose("País", "México"); await choose("Estados", "Ciudad de México"); }
  if (kind === "screening_answer") { await choose("Pregunta", "¿Viajas?"); await choose("Respuestas aceptadas", "Sí"); }
  if (kind === "manual") fireEvent.change(screen.getByLabelText("Etiqueta"), { target: { value: "Disponibilidad" } });
  const detail = screen.getByRole("region", { name: "Detalle del criterio" });
  expect(detail.querySelector('[data-slot="card-header"] [data-slot="card-title"]')).not.toBeNull();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveChecklistAction).toHaveBeenCalled());
  const sent = (vi.mocked(saveChecklistAction).mock.calls[0][0].body as Checklist).criteria[0];
  expect(sent).toMatchObject({ kind, importance: "required" });
  const params = { min_years_experience: { min: "1" }, seniority: { accepted: ["senior"] }, education: { min_level: "bachelor", accepts_in_progress: false }, language: { code: "en", min_level: "B2" }, skill: { name: "SQL" }, location: { country: "MX", states: ["09"] }, screening_answer: { question_id: id, accepted_option_ids: [option] }, manual: {} };
  expect(sent.params).toEqual(params[kind as keyof typeof params]);
  if (kind === "language") expect(sent.label).toBe("Idioma: Inglés · mínimo B2");
  if (kind === "location") expect(sent.label).toContain("México");
});
it("preserves identity on label/importance edits and replaces it on parameter changes", async () => {
  const criterion: Criterion = { ...manual, kind: "min_years_experience", params: { min: "3" } };
  editor({ ...empty, version: "1", criteria: [criterion] });
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Disponibilidad" }));
  fireEvent.change(screen.getByLabelText("Etiqueta"), { target: { value: "Experiencia" } });
  const importance = screen.getByRole("group", { name: "Importancia: Experiencia" });
  fireEvent.click(within(importance).getByRole("button", { name: "Deseable" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveChecklistAction).toHaveBeenCalledTimes(1));
  expect((vi.mocked(saveChecklistAction).mock.calls[0][0].body as Checklist).criteria[0]).toMatchObject({ id, label: "Experiencia", importance: "desirable" });
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar Experiencia" }));
  fireEvent.change(screen.getByLabelText("Años mínimos"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveChecklistAction).toHaveBeenCalledTimes(2));
  const sent = vi.mocked(saveChecklistAction).mock.calls[1][0];
  expect(sent.ifMatch).toBe('"saved"');
  expect((sent.body as Checklist).criteria[0].id).not.toBe(id);
  expect((sent.body as Checklist).criteria[0].params).toEqual({ min: "5" });
});
it("uses the detail menu to move the selection and remove it to its neighbor", async () => {
  editor({ ...empty, version: "1", criteria: [manual, { ...manual, id: nextId, label: "Otro" }] });
  async function action(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Acciones de Disponibilidad" }));
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  }
  await action("Bajar");
  expect(screen.getByText("Criterio 2 de 2 · Manual")).toBeVisible();
  expect(screen.getByLabelText("Etiqueta")).toHaveValue("Disponibilidad");
  await action("Subir");
  expect(screen.getByText("Criterio 1 de 2 · Manual")).toBeVisible();
  await action("Quitar criterio");
  expect(screen.queryByRole("button", { name: "Seleccionar Disponibilidad" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Etiqueta")).toHaveValue("Otro");
});
it("removes and reorders without changing ids; exposes accessible row menus", () => {
  const other = { ...manual, id: nextId, label: "Otro" };
  editor({ ...empty, criteria: [manual, other] });
  expect(screen.getByRole("button", { name: "Acciones de Disponibilidad" })).toHaveAttribute("aria-haspopup", "menu");
  expect(criterionActions(0, 2)).toEqual([{ key: "up", label: "Subir", disabled: true }, { key: "down", label: "Bajar", disabled: false }, { key: "remove", label: "Quitar criterio", disabled: false }]);
  expect(applyCriterionAction([manual, other], 0, "down")).toEqual([other, manual]);
  expect(applyCriterionAction([manual, other], 1, "up")).toEqual([other, manual]);
  expect(applyCriterionAction([manual, other], 0, "remove")).toEqual([other]);
});
it.each([
  ["validation_error", "Revisa los datos marcados"], ["version_conflict", "Esto cambió en otro lugar"], ["precondition_required", "Necesitamos actualizar el checklist"], ["process_finished", "El proceso ya terminó; el checklist ya no se puede cambiar"], ["no_response", "No hubo respuesta del servidor"],
] as const)("maps %s without losing local edits or replaying the write", async (reason, text) => {
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason, reference: {} });
  editor(); fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" })); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByText(text)).toBeVisible();
  expect(screen.getByText("Habilidad: SQL")).toBeVisible();
  expect(saveChecklistAction).toHaveBeenCalledTimes(1);
});
it.each([
  ["criteria[0].params.question_id", "La pregunta ya no existe; quítala o cámbiala"],
  ["criteria[0].params.accepted_option_ids[0]", "La respuesta ya no existe; quítala o cámbiala"],
  ["criteria[0].label", "Revisa este criterio"],
  ["reminder_stage_ids[0]", "La etapa ya no existe; actualiza las columnas"],
])("maps validation field %s to its row or reminder group", async (field, message) => {
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason: "validation_error", fields: [{ field, code: "invalid" }], reference: {} });
  editor(); fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" })); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByText(message)).toBeVisible();
  if (field.startsWith("criteria")) expect(within(screen.getAllByRole("listitem")[0]).getByText(message)).toBeVisible();
});
it("checks uncertain writes by reading only and preserves edits when the check fails", async () => {
  vi.mocked(saveChecklistAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  editor(); fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" })); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  // The read intentionally fails: preserve local work and keep writes locked until checked.
  expect(saveChecklistAction).toHaveBeenCalledTimes(1);
  expect(loadChecklistAction).toHaveBeenCalledWith(id);
  expect(await screen.findByText("No pudimos cargar la versión guardada")).toBeVisible();
});
