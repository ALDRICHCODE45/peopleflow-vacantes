import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadProfileAction, saveProfileAction } from "../actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { COMPETENCY_IDS, type Profile } from "../model";
import { ProfileEditor } from "./editor";
// jsdom cannot position Base UI portals. Only the popup shell is replaced;
// the real trigger, controlled open state, checkboxes and saved bodies remain exercised.
vi.mock("@/components/ui/popover", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/popover")>();
  return { ...actual, PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PopoverTitle: ({ children }: { children: React.ReactNode }) => <h5>{children}</h5> };
});
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const profile = (): Profile => ({ version: "0", enabled: false, test: "ipip60-mx", confirmed: false, confirmed_at: null, competencies: COMPETENCY_IDS.map(competency_id => ({ competency_id, importance: "importance.no_relevante", desired_band: null, rationale: null, task: null })), auto_send_stage_ids: [], expires_in_days: 7 });
const stages = [{ id: "123e4567-e89b-42d3-a456-426614174000", kind: "screening" as const, name: "Entrevista" }];
const mount = (data = profile()) => render(<ProfileEditor draftId="vacancy" profile={data} etag={'"pp1"'} stages={stages} />);
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); vi.resetAllMocks(); vi.mocked(saveProfileAction).mockImplementation(async input => ({ ok: true, data: { ...input.body as Profile, version: "1", confirmed_at: (input.body as Profile).confirmed ? "2026-10-29T12:00:00Z" : null }, etag: '"pp2"' })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const selectRow = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
const bandGroup = () => screen.getByRole("group", { name: "Banda deseada" });
it("renders never-saved defaults, seven disabled bands and does not invent suggestions", () => {
  mount(); expect(screen.getByRole("switch")).not.toBeChecked(); expect(screen.getByText("Perfil sin confirmar")).toHaveAttribute("data-variant", "accent");
  for (const name of ["Orden para avanzar", "Cuidado de acuerdos", "Impulso para coordinar", "Apoyo entre pares", "Apertura a probar", "Pausa para decidir", "Manejo de la presión"]) {
    selectRow(name);
    for (const band of within(bandGroup()).getAllByRole("button")) expect(band).toBeDisabled();
  }
  expect(screen.getByRole("spinbutton")).toHaveValue(7);
  expect(screen.queryByRole("textbox", { name: /Justificación laboral/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Tarea concreta/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" }));
  expect(screen.getByText("No hay reglas de sugerencia disponibles")).toBeVisible(); expect(saveProfileAction).not.toHaveBeenCalled();
});
it("shows the competency hypothesis once for the whole list", () => {
  mount();
  expect(screen.getAllByText("La relación con esta competencia es una hipótesis. Confírmala con ejemplos de trabajo.")).toHaveLength(1);
});
it("shows only the supporting fields required by each row's importance", () => {
  const data = profile();
  data.competencies[0] = { ...data.competencies[0], importance: "importance.clave", desired_band: "band.high", rationale: "Plan semanal", task: "Cerrar entregas" };
  data.competencies[1] = { ...data.competencies[1], importance: "importance.importante", desired_band: "band.medium", rationale: "Cumplir acuerdos" };
  mount(data);
  expect(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ })).toHaveValue("Cerrar entregas");
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Orden/ })).toHaveValue("Plan semanal");
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  selectRow("Cuidado de acuerdos");
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ })).toHaveValue("Cumplir acuerdos");
  expect(screen.queryByRole("textbox", { name: /Tarea concreta de Cuidado/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  selectRow("Impulso para coordinar");
  expect(screen.queryByRole("textbox", { name: /Tarea concreta de Impulso/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Justificación laboral de Impulso/ })).not.toBeInTheDocument();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  for (const band of within(bandGroup()).getAllByRole("button")) expect(band).toBeDisabled();
  expect(screen.getByText("Sin banda", { selector: "p" })).toBeVisible();
  expect(saveProfileAction).not.toHaveBeenCalled();
});
it("saves full replacement with opaque If-Match and adopts the new version", async () => {
  mount(); fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("button", { name: "Crear invitación al entrar a estas etapas" })); fireEvent.click(await screen.findByRole("checkbox", { name: "Entrevista" })); fireEvent.click(screen.getByRole("button", { name: "Crear invitación al entrar a estas etapas" }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText("Perfil guardado");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado" }));
  expect(saveProfileAction).toHaveBeenCalledWith({ vacancyId: "vacancy", ifMatch: '"pp1"', body: { enabled: true, test: "ipip60-mx", confirmed: false, competencies: profile().competencies, expires_in_days: 30, auto_send_stage_ids: [stages[0].id] } });
  expect(screen.getByRole("switch")).toBeChecked(); expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } }); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ ifMatch: '"pp2"', body: expect.objectContaining({ expires_in_days: 1 }) })));
});
it.each([0, 31, 1.5])("rejects expiration %s without writing", async value => {
  mount(); fireEvent.change(screen.getByRole("spinbutton"), { target: { value: String(value) } }); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(screen.getByRole("spinbutton")).toHaveFocus()); expect(screen.getByRole("spinbutton")).toHaveAccessibleDescription("Usa un número entero de 1 a 30"); expect(saveProfileAction).not.toHaveBeenCalled();
});
it("requires rationale only on relevant competencies and task only on key competencies to confirm", async () => {
  const data = profile(); data.competencies[0] = { ...data.competencies[0], importance: "importance.clave", desired_band: "band.low", rationale: "" }; mount(data);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar perfil" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ })).toHaveFocus()); expect(saveProfileAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ }), { target: { value: "Cerrar entregas" } });
  for (const field of screen.getAllByRole("textbox", { name: /Justificación laboral/ })) fireEvent.change(field, { target: { value: "Trabajo concreto" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar perfil" })); await screen.findByText(/Perfil confirmado ·/);
  expect(saveProfileAction).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ confirmed: true, enabled: false }) }));
  fireEvent.change(screen.getAllByRole("textbox", { name: /Justificación laboral/ })[0], { target: { value: "Otro trabajo" } });
  expect(screen.getByText("Perfil sin confirmar")).toBeVisible();
});
it.each(["version_conflict", "precondition_required"] as const)("preserves input on %s, blocks replay and explicitly reloads", async reason => {
  vi.mocked(saveProfileAction).mockResolvedValue({ ok: false, reason, reference: { status: reason === "version_conflict" ? 412 : 428 } });
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: profile(), etag: '"fresh"' }); mount(); fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  const reload = await screen.findByRole("button", { name: "Cargar versión actual" }); expect(screen.getByRole("switch")).toBeChecked(); expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled(); expect(loadProfileAction).not.toHaveBeenCalled();
  fireEvent.click(reload); await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked()); expect(saveProfileAction).toHaveBeenCalledTimes(1);
});
it("maps server fields, preserves input and focuses first visual error", async () => {
  vi.mocked(saveProfileAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "expires_in_days", code: "invalid" }, { field: "competencies[0].rationale", code: "required" }] });
  const data = profile(); data.competencies[0] = { ...data.competencies[0], importance: "importance.importante", desired_band: "band.medium", rationale: "" };
  mount(data); fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(screen.getAllByRole("textbox", { name: /Justificación laboral/ })[0]).toHaveFocus()); expect(screen.getAllByRole("textbox", { name: /Justificación laboral/ })[0]).toHaveAttribute("aria-invalid", "true"); expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-invalid", "true"); expect(screen.getByRole("switch")).toBeChecked();
});
it("selects importance and a desired low band, then clears the band when irrelevant", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Clave" }));
  expect(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ })).toBeVisible();
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Orden/ })).toHaveValue("");
  const band = screen.getByRole("button", { name: "Medio" }); expect(band).not.toBeDisabled(); expect(band).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Bajo" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" })); await screen.findByText("Perfil guardado");
  expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ confirmed: false, competencies: expect.arrayContaining([expect.objectContaining({ competency_id: "comp.organizacion", importance: "importance.clave", desired_band: "band.low", task: null })]) }) }));
  fireEvent.change(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ }), { target: { value: "Cerrar entregas" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Justificación laboral de Orden/ }), { target: { value: "Trabajo concreto" } });
  fireEvent.click(screen.getByRole("button", { name: "No relevante" }));
  expect(screen.queryByRole("textbox", { name: /Tarea concreta de Orden/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Justificación laboral de Orden/ })).not.toBeInTheDocument();
  expect(band).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveProfileAction).toHaveBeenCalledTimes(2));
  expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ competencies: expect.arrayContaining([expect.objectContaining({ competency_id: "comp.organizacion", desired_band: null, rationale: null, task: null })]) }) }));
});
it("initializes Importante with a middle band and empty rationale; drafts save but confirmation requires rationale only", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Importante" }));
  expect(screen.getByRole("button", { name: "Medio" })).toHaveAttribute("aria-pressed", "true");
  const rationale = screen.getByRole("textbox", { name: /Justificación laboral de Orden/ }); expect(rationale).toHaveValue(""); expect(screen.queryByRole("textbox", { name: /Tarea concreta/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" })); await screen.findByText("Perfil guardado");
  expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ competencies: expect.arrayContaining([expect.objectContaining({ importance: "importance.importante", desired_band: "band.medium", rationale: "", task: null })]) }) }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar perfil" })); await waitFor(() => expect(rationale).toHaveFocus()); expect(rationale).toHaveAttribute("aria-invalid", "true"); expect(saveProfileAction).toHaveBeenCalledTimes(1);
  fireEvent.change(rationale, { target: { value: "Coordinar entregas" } }); fireEvent.click(screen.getByRole("button", { name: "Confirmar perfil" })); await screen.findByText(/Perfil confirmado ·/); expect(saveProfileAction).toHaveBeenCalledTimes(2);
});
it("labels competencies by id even if the server returns a different order", () => {
  const data = profile(); data.competencies.reverse(); data.competencies[0] = { ...data.competencies[0], importance: "importance.importante", desired_band: "band.medium", rationale: "Presión laboral" }; mount(data);
  expect(screen.getByRole("textbox", { name: "Justificación laboral de Manejo de la presión *" })).toHaveValue("Presión laboral");
});
it("locks writes after process_finished while preserving captured values", async () => {
  vi.mocked(saveProfileAction).mockResolvedValue({ ok: false, reason: "process_finished", reference: { status: 409 } }); mount(); fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText("El proceso ya terminó"); expect(screen.getByRole("switch")).toBeDisabled(); expect(screen.getByRole("switch")).toBeChecked(); expect(screen.getByRole("button", { name: "Confirmar perfil" })).toBeDisabled();
});
