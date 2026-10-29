import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadProfileAction, saveProfileAction } from "../actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { COMPETENCY_IDS, type Profile } from "../model";
import { ProfileEditor } from "./editor";
// Same controlled Select boundary as delivery-config/editor.test.tsx: jsdom cannot position Base UI portals.
// Keep product handlers/body assertions real; popup positioning and Base UI keyboard behavior need browser QA.
vi.mock("@/components/ui/select", () => {
  type State = { value: string | null; items: { value: string; label: string }[]; disabled?: boolean; id: string; open: boolean; toggle: () => void; change: (value: string) => void };
  const Context = React.createContext<State>({ value: null, items: [], id: "", open: false, toggle: () => {}, change: () => {} });
  return {
    Select: ({ value, items, disabled, onValueChange, children }: Omit<State, "id" | "open" | "toggle" | "change"> & { onValueChange: State["change"]; children: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      const id = React.useId();
      return <Context.Provider value={{ value, items, disabled, id, open, toggle: () => { if (!disabled) setOpen(!open); }, change: next => { if (!disabled) { onValueChange(next); setOpen(false); } } }}>{children}</Context.Provider>;
    },
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => { const state = React.useContext(Context); return <button type="button" role="combobox" aria-controls={state.id} aria-expanded={state.open} disabled={state.disabled} onClick={state.toggle} {...props}>{children}</button>; },
    SelectValue: ({ placeholder }: { placeholder?: string }) => { const state = React.useContext(Context); return state.items.find(item => item.value === state.value)?.label ?? placeholder; },
    SelectContent: ({ children }: { children: React.ReactNode }) => { const state = React.useContext(Context); return state.open ? <div role="listbox" id={state.id}>{children}</div> : null; },
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => { const state = React.useContext(Context); return <button type="button" role="option" aria-selected={state.value === value} onClick={() => state.change(value)}>{children}</button>; },
  };
});
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const profile = (): Profile => ({ version: "0", enabled: false, test: "ipip60-mx", confirmed: false, confirmed_at: null, competencies: COMPETENCY_IDS.map(competency_id => ({ competency_id, importance: "importance.no_relevante", desired_band: null, rationale: null, task: null })), auto_send_stage_ids: [], expires_in_days: 7 });
const stages = [{ id: "123e4567-e89b-42d3-a456-426614174000", kind: "screening" as const, name: "Entrevista" }];
const mount = (data = profile()) => render(<ProfileEditor draftId="vacancy" profile={data} etag={'"pp1"'} stages={stages} />);
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); vi.resetAllMocks(); vi.mocked(saveProfileAction).mockImplementation(async input => ({ ok: true, data: { ...input.body as Profile, version: "1", confirmed_at: (input.body as Profile).confirmed ? "2026-10-29T12:00:00Z" : null }, etag: '"pp2"' })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("renders never-saved defaults, seven disabled bands and does not invent suggestions", () => {
  mount(); expect(screen.getByRole("switch")).not.toBeChecked(); expect(screen.getByText("Perfil sin confirmar")).toHaveAttribute("data-variant", "accent");
  expect(screen.getAllByRole("combobox", { name: /Banda deseada/ })).toHaveLength(7);
  for (const band of screen.getAllByRole("combobox", { name: /Banda deseada/ })) expect(band).toBeDisabled();
  expect(screen.getByRole("spinbutton")).toHaveValue(7);
  expect(screen.queryByRole("textbox", { name: /Justificación laboral/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Tarea concreta/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sugerir desde la vacante" }));
  expect(screen.getByText("No hay reglas de sugerencia disponibles")).toBeVisible(); expect(saveProfileAction).not.toHaveBeenCalled();
});
it("saves full replacement with opaque If-Match and adopts the new version", async () => {
  mount(); fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByRole("checkbox", { name: "Entrevista" }));
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
  mount(); const importance = screen.getByRole("combobox", { name: "Importancia de Orden para avanzar" });
  fireEvent.click(importance); fireEvent.click(await screen.findByRole("option", { name: "Clave" }));
  expect(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ })).toBeVisible();
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Orden/ })).toHaveValue("");
  const band = screen.getByRole("combobox", { name: "Banda deseada de Orden para avanzar" }); expect(band).not.toBeDisabled(); expect(band).toHaveTextContent("Medio");
  fireEvent.click(band); fireEvent.click(await screen.findByRole("option", { name: "Bajo" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" })); await screen.findByText("Perfil guardado");
  expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ confirmed: false, competencies: expect.arrayContaining([expect.objectContaining({ competency_id: "comp.organizacion", importance: "importance.clave", desired_band: "band.low", task: null })]) }) }));
  fireEvent.change(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ }), { target: { value: "Cerrar entregas" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Justificación laboral de Orden/ }), { target: { value: "Trabajo concreto" } });
  fireEvent.click(importance); fireEvent.click(await screen.findByRole("option", { name: "No relevante" }));
  expect(screen.queryByRole("textbox", { name: /Tarea concreta de Orden/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Justificación laboral de Orden/ })).not.toBeInTheDocument();
  expect(band).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(saveProfileAction).toHaveBeenCalledTimes(2));
  expect(saveProfileAction).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ competencies: expect.arrayContaining([expect.objectContaining({ competency_id: "comp.organizacion", desired_band: null, rationale: null, task: null })]) }) }));
});
it("initializes Importante with a middle band and empty rationale; drafts save but confirmation requires rationale only", async () => {
  mount(); fireEvent.click(screen.getByRole("combobox", { name: "Importancia de Orden para avanzar" })); fireEvent.click(await screen.findByRole("option", { name: "Importante" }));
  expect(screen.getByRole("combobox", { name: "Banda deseada de Orden para avanzar" })).toHaveTextContent("Medio");
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
