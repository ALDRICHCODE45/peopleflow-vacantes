import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamView } from "./team-view";
import { ReassignDialog } from "./reassign-dialog";
import { DeadlineDialog } from "./deadline-dialog";
import { TeamApi } from "./api";
import { TeamError } from "./client";
import { createFixtureClient } from "./prototype-client";
import { createApiClient } from "./action-client";
import { notifyActionResult } from "@/components/feedback/notify";
vi.mock("./action-client", () => ({ createApiClient: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("./controls", () => ({
  PersonField: ({ label, members, value, onChange }: ComponentProps<typeof import("./controls").PersonField>) => <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="" />{members.map((member) => <option key={member.id} value={member.user.id}>{member.user.full_name}</option>)}</select></label>,
  ChoiceField: ({ label, items, value, onChange }: ComponentProps<typeof import("./controls").ChoiceField>) => <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="" />{items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>,
}));
vi.mock("@/features/employer-vacancies/delivery-config/date-field", () => ({ BusinessDateField: ({ label, value, onChange, description }: ComponentProps<typeof import("@/features/employer-vacancies/delivery-config/date-field").BusinessDateField>) => <><label>{label}<input value={value ?? ""} onChange={event => onChange(event.target.value)} /></label><span>{description}</span></> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("reassign keeps current members' deadline and only offers dates for a new member", async () => {
  const client = createFixtureClient("owner"); const team = await client.getTeam(); const company = await client.getCompanyMembers(); const onConfirm = vi.fn();
  render(<ReassignDialog team={team} company={company} calendar={client.calendar} onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(screen.queryByLabelText("Plazo del reclutador")).not.toBeInTheDocument();
  const newcomer = company.members.find(person => !team.members.some(member => member.user.id === person.user.id))!;
  fireEvent.change(screen.getByLabelText("Nuevo responsable"), { target: { value: newcomer.user.id } });
  fireEvent.change(screen.getByLabelText("Plazo del reclutador"), { target: { value: "2026-11-25" } });
  fireEvent.change(screen.getByLabelText("Nuevo responsable"), { target: { value: team.members[1].user.id } });
  expect(screen.queryByLabelText("Plazo del reclutador")).not.toBeInTheDocument();
  expect(screen.getByText(/Para cambiar su plazo, usa Editar plazo\./)).toHaveTextContent("30 nov 2026");
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "workload" } });
  fireEvent.click(screen.getByRole("button", { name: "Reasignar" }));
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ recruiter_deadline: null, to_user_id: team.members[1].user.id }));
  fireEvent.change(screen.getByLabelText("Nuevo responsable"), { target: { value: newcomer.user.id } });
  fireEvent.click(screen.getByRole("button", { name: "Reasignar" }));
  expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ recruiter_deadline: "2026-11-25" }));
});
it.each(["2026-11-30", null])("uses the api commitment date, not the snapshot, in all deadline helpers (%s)", async commitmentDate => {
  const fixture = createFixtureClient("owner");
  const client = { ...fixture, persisted: true, snapshot: undefined, commitmentDate };
  const view = render(<TeamView client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar al equipo" }));
  expect(screen.getByText(commitmentDate ? "Sin plazo propio, se usa la fecha compromiso: 30 nov 2026." : "Sin plazo propio. Esta vacante todavía no tiene fecha compromiso.")).toBeVisible();
  view.unmount();
  const team = await fixture.getTeam();
  const props = { calendar: client.calendar, commitmentDate, pending: false, onConfirm: vi.fn(), onClose: vi.fn() };
  const deadline = render(<DeadlineDialog member={team.members[0]} {...props} />);
  const copy = commitmentDate ? "Si no lo defines, aplica la fecha compromiso: 30 de noviembre de 2026." : "Sin plazo propio. Esta vacante todavía no tiene fecha compromiso.";
  expect(screen.getByText(copy)).toBeVisible();
  deadline.unmount();
  render(<ReassignDialog team={team} company={await fixture.getCompanyMembers()} {...props} />);
  fireEvent.change(screen.getByLabelText("Nuevo responsable"), { target: { value: "user-luis" } });
  expect(screen.getByText(copy)).toBeVisible();
});
it("reserves a full-width status row above the three team actions", async () => {
  const fixture = createFixtureClient("owner");
  const team = await fixture.getTeam(); team.viewer.can.leave = true;
  render(<TeamView client={{ ...fixture, persisted: true, getTeam: async () => team, changeMode: async () => team }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  const status = await screen.findByText("Modo del equipo cambiado.");
  const footer = document.querySelector('#current-team [data-slot="card-footer"]')!;
  const bar = footer.querySelector('[data-pf-action-bar]')!;
  expect(bar).toHaveClass("flex-col");
  const row = footer.querySelector('[data-pf-action-status-slot]')!.parentElement!;
  expect(row).toContainElement(status);
  expect(row).toHaveClass("w-full");
  expect(row).not.toContainElement(screen.getByRole("button", { name: "Agregar al equipo" }));
  expect(bar.querySelector('[data-pf-action-bar-actions]')).toHaveClass("max-sm:flex-col", "max-sm:w-full");
});
const errors = [
  [409, "responsible_cannot_leave", "El dueño debe asignar un reemplazo antes de tu salida."],
  [409, "team_last_member", "El equipo debe conservar al menos una persona."],
  [409, "use_reassign_responsible", "Para retirar al responsable, usa Reasignar responsable."],
  [409, "team_member_already_active", "Esta persona ya está en el equipo."],
  [422, "not_company_member", "Esta persona ya no pertenece a la empresa."],
  [409, "reassign_target_is_responsible", "Esta persona ya es responsable de la vacante."],
  [422, "reassignment_note_required", "Escribe una nota para el motivo Otro."],
  [409, "team_mode_unchanged", "Elige un modo distinto al actual."],
  [422, "responsible_not_on_team", "El responsable debe ser una persona del equipo actual."],
  [422, "recruiter_deadline_not_applicable", "Esta persona ya tiene un plazo. Para cambiarlo, usa Editar plazo."],
  [422, "responsible_not_applicable", "Un equipo sin responsable no puede recibir un responsable."],
  [412, "team_version_conflict", "El equipo cambió mientras lo editabas. Recargamos los datos; revisa y vuelve a intentarlo."],
  [403, "team_action_forbidden", "No tienes permiso para esta acción."],
] as const;
it.each(errors)("maps %s %s and keeps validation inputs without success", async (status, code, text) => {
  const fixture = createFixtureClient("owner");
  const getTeam = vi.spyOn(fixture, "getTeam"); const getHistory = vi.spyOn(fixture, "getHistory");
  const changeMode = vi.fn().mockRejectedValue(new TeamError(code, status));
  render(<TeamView client={{ ...fixture, persisted: true, changeMode }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description: text })));
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(changeMode).toHaveBeenCalledWith({ mode: "shared" });
  expect(getTeam).toHaveBeenCalledTimes(status === 412 || status === 403 ? 2 : 1);
  expect(getHistory).toHaveBeenCalledTimes(status === 412 ? 2 : 1);
  expect(notifyActionResult).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});
it("api mode exposes only can actions, saves with real feedback and reloads first-page history", async () => {
  const fixture = createFixtureClient("owner"); const getHistory = vi.spyOn(fixture, "getHistory");
  vi.mocked(createApiClient).mockReturnValue({ ...fixture, persisted: true });
  render(<TeamApi vacancyId="vacancy" />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Modo del equipo cambiado" })));
  expect(getHistory).toHaveBeenLastCalledWith();
});
it("switching to responsible sends the selected active user", async () => {
  const client = createFixtureClient("shared"); const changeMode = vi.spyOn(client, "changeMode");
  render(<TeamView client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: "user-ana" } });
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(changeMode).toHaveBeenCalledWith({ mode: "with_responsible", responsible_user_id: "user-ana" }));
});
it("freezes an uncertain confirmation until explicit retry resolves it", async () => {
  const fixture = createFixtureClient("owner");
  const changeMode = vi.fn().mockRejectedValueOnce(new TeamError("write_failed", 200)).mockResolvedValue(await fixture.getTeam());
  render(<TeamView client={{ ...fixture, persisted: true, changeMode }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Cambio sin confirmar" })));
  expect(dialog.querySelector('[data-slot="field-group"]')).toHaveAttribute("inert");
  expect(changeMode).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
  expect(changeMode).toHaveBeenCalledTimes(2);
  expect(changeMode.mock.calls[1]).toEqual(changeMode.mock.calls[0]);
});
it("keeps add inputs and the visible team unchanged on a validation rejection", async () => {
  const fixture = createFixtureClient("owner"); const before = await fixture.getTeam();
  const addMember = vi.fn().mockRejectedValue(new TeamError("not_company_member", 422));
  render(<TeamView client={{ ...fixture, persisted: true, addMember }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agregar al equipo" }));
  fireEvent.change(screen.getByLabelText("Persona de la empresa"), { target: { value: "user-sofia" } });
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Agregar" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalled());
  expect(screen.getByLabelText("Persona de la empresa")).toHaveValue("user-sofia");
  expect(await fixture.getTeam()).toEqual(before);
  expect(screen.getByRole("alertdialog")).toBeVisible();
});
it("refreshes capability-only actions after a forbidden write", async () => {
  const fixture = createFixtureClient("owner"); const team = await fixture.getTeam();
  const updated = structuredClone(team); updated.viewer.can.change_mode = false;
  const getTeam = vi.fn().mockResolvedValueOnce(team).mockResolvedValue(updated);
  render(<TeamView client={{ ...fixture, getTeam, changeMode: async () => { throw new TeamError("team_action_forbidden", 403); } }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Cambiar modo" })).not.toBeInTheDocument());
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
it("access-ended after a write replaces the team", async () => {
  const fixture = createFixtureClient("owner");
  render(<TeamView client={{ ...fixture, changeMode: async () => { throw new TeamError("team_access_ended", 404); } }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cambiar modo" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar modo" }));
  expect(await screen.findByRole("heading", { name: "Ya no formas parte del equipo de esta vacante" })).toBeVisible();
});
