import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
// Base UI menu positioning cannot settle in jsdom (§13.7). This suite tests the
// controller through a deterministic menu double; team-menu.test.tsx checks the real trigger.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, setOpen: (open: boolean) => { void open; } });
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return <Context.Provider value={{ open, setOpen }}>{children}</Context.Provider>;
    },
    DropdownMenuTrigger: ({ render: _render, ...props }: React.ComponentProps<"button"> & { render: React.ReactNode }) => {
      void _render;
      const { open, setOpen } = React.useContext(Context);
      return <button {...props} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />;
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuItem: ({ onClick, variant: _variant, ...props }: React.ComponentProps<"button"> & { variant?: string }) => {
      void _variant;
      const { setOpen } = React.useContext(Context);
      return <button {...props} role="menuitem" onClick={event => { onClick?.(event); setOpen(false); }} />;
    },
  };
});
vi.mock("./actions", () => ({ listTeamMembersAction: vi.fn(), changeTeamRoleAction: vi.fn(), removeTeamMemberAction: vi.fn(), previewOffboardAction: vi.fn(), offboardMemberAction: vi.fn() }));
vi.mock("@/features/employer-company/use-company-membership", () => ({ useCompanyMembership: vi.fn() }));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/features/stakeholder-invitations/actions", () => ({ listStakeholderInvitationsAction: vi.fn(async () => ({ ok: true, items: [] })), createStakeholderInvitationAction: vi.fn(), revokeStakeholderInvitationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
import { TeamPage } from "@/features/employer-team/team-page";
import { listTeamMembersAction, changeTeamRoleAction, removeTeamMemberAction, previewOffboardAction, offboardMemberAction } from "@/features/employer-team/actions";
import { useCompanyMembership } from "@/features/employer-company/use-company-membership";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import { IdentityContext, type IdentityState } from "@/features/identity/identity-session";
import { notifyActionResult } from "@/components/feedback/notify";
import { listStakeholderInvitationsAction } from "@/features/stakeholder-invitations/actions";
import { members, selfId, draft } from "./test-fixtures";
import * as offboarding from "./offboard-client";
const identity: IdentityState = { status: "ready", result: { ok: true, data: { role: "recruiter", user: { id: selfId, full_name: "Ana Real", email: "ana@example.test" } } }, email: "ana@example.test", retry() {}, update() {} };
const membership = { kind: "exists", role: "owner", company: { id: members[0].company_id } } as ReturnType<typeof useCompanyMembership>;
function mount(value = identity) { return render(<IdentityContext.Provider value={value}><TeamPage /></IdentityContext.Provider>); }
function row(id: string) { return document.querySelector(`[data-pf-team-row="${id}"]`) as HTMLElement; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useCompanyMembership).mockReturnValue(membership);
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members });
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [draft("a"), draft("b", { status: "paused" }), draft("c", { status: "closed" }), draft("d", { process: "finished" })], nextCursor: null });
  vi.mocked(changeTeamRoleAction).mockResolvedValue({ ok: true });
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it.each([["development", "0"], ["production", "1"], ["production", "api"], ["production", ""]])("preserves today's removal with NODE_ENV=%s and flag=%s", async (environment, flag) => {
  vi.stubEnv("NODE_ENV", environment); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  const preview = vi.spyOn(offboarding, "createOffboardFixtureClient");
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  expect(screen.getByRole("heading", { name: "¿Quitar a José Real del equipo?" })).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar del equipo" }));
  expect(removeTeamMemberAction).toHaveBeenCalledExactlyOnceWith(members[1].id);
  expect(preview).not.toHaveBeenCalled();
});
it.each(["none", "collaborator", "responsible"] as const)("previews %s before confirming and only removes in memory", async scenario => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "1");
  const client = offboarding.createOffboardFixtureClient(members, scenario);
  const preview = vi.spyOn(client, "preview");
  vi.spyOn(offboarding, "createOffboardFixtureClient").mockReturnValue(client);
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  await screen.findByRole("alertdialog");
  expect(preview).toHaveBeenCalledExactlyOnceWith(members[1].id);
  expect(await client.list()).toEqual(members);
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: scenario === "responsible" ? "Quitar y reasignar" : "Quitar del equipo" }));
  await waitFor(() => expect(screen.queryByText("José Real")).not.toBeInTheDocument());
  expect(await client.list()).toEqual([members[0]]);
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  expect(listTeamMembersAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
});
it("retains the dialog, selections and member after an offboard 422", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "1");
  const client = offboarding.createOffboardFixtureClient(members, "responsible");
  const preview = await client.preview(members[1].id);
  vi.spyOn(client, "offboard").mockRejectedValue(new offboarding.OffboardError(422, "offboard_unresolved_vacancies", preview.vacancies));
  vi.spyOn(offboarding, "createOffboardFixtureClient").mockReturnValue(client);
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  await user.click(await screen.findByRole("button", { name: "Quitar y reasignar" }));
  expect(await screen.findByText(/Elige responsable para:/)).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Pasar todas a" })).toHaveValue("Ana Real");
  expect(await client.list()).toEqual(members);
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 422, code: "offboard_unresolved_vacancies" }) }));
});
it.each([false, true])("uses real offboarding, including a DELETE race=%s", async race => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "api");
  const preview = await offboarding.createOffboardFixtureClient(members, "responsible").preview(members[1].id);
  vi.mocked(previewOffboardAction).mockResolvedValue({ ok: true, data: race ? { ...preview, vacancies: [] } : preview });
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: false, reason: "invalid_request", reference: { status: 409, code: "member_is_responsible" }, vacancies: preview.vacancies });
  vi.mocked(offboardMemberAction).mockResolvedValue({ ok: true, data: { user_id: preview.user.id, handed_over: preview.vacancies.map(v => ({ draft_id: v.draft_id, hand_over: v.hand_over, to_user_id: members[0].user.id, reassignment_id: members[0].id })), ended_assignment_ids: [] } });
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: true, members }).mockResolvedValue({ ok: true, members: [members[0]] });
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  if (race) await user.click(await screen.findByRole("button", { name: "Quitar del equipo" }));
  const confirm = await screen.findByRole("button", { name: "Quitar y reasignar" });
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  await user.click(confirm);
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
  expect(offboardMemberAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(offboardMemberAction).mock.calls[0][0]).toBe(members[1].id);
  expect(notifyActionResult).toHaveBeenCalledExactlyOnceWith({ key: "team-member-write", type: "success", title: "José Real salió de la empresa. Pasaron 2 vacantes a otras personas." });
  expect(screen.queryByText("José Real")).not.toBeInTheDocument();
});
it.each(["offboard_unresolved_vacancies", "offboard_reassignment_not_applicable", "not_company_member"])("keeps real offboard rejection %s in the existing feedback", async code => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", "api");
  const preview = await offboarding.createOffboardFixtureClient(members, "responsible").preview(members[1].id);
  vi.mocked(previewOffboardAction).mockResolvedValue({ ok: true, data: preview });
  vi.mocked(offboardMemberAction).mockResolvedValue({ ok: false, reason: "invalid_request", reference: { status: 422, code }, vacancies: preview.vacancies });
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  await user.click(await screen.findByRole("button", { name: "Quitar y reasignar" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledTimes(1));
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description: code === "offboard_unresolved_vacancies" ? "Elige a otra persona para las vacantes pendientes." : code === "not_company_member" ? "La persona elegida ya no pertenece a la empresa. Elige a alguien del equipo actual." : "Las vacantes cambiaron. Cierra y vuelve a consultar la salida." }));
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(screen.getByText("José Real")).toBeVisible();
  expect(listTeamMembersAction).toHaveBeenCalledTimes(1);
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  if (code === "offboard_unresolved_vacancies") expect(screen.getAllByText("Elige a otra persona para esta vacante.")).toHaveLength(2);
});
it("renders only real members, role labels, dates and three factual summaries", async () => {
  mount();
  expect(await screen.findByText("José Real")).toBeInTheDocument();
  expect(screen.getByText("jose@example.test")).toBeInTheDocument();
  expect(within(row(members[0].id)).getByText("Dueño")).toBeInTheDocument();
  expect(within(row(members[1].id)).getByText(/Miembro desde/)).toHaveTextContent(/2026/);
  expect(document.querySelectorAll("[data-pf-team-metric]")).toHaveLength(3);
  expect(screen.queryByRole("group", { name: "Filtrar por estado" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Tomás Ríos|Valeria Ortiz|Invitación pendiente/)).not.toBeInTheDocument();
});
it("reserves no empty status row between the search and the results until an action reports", async () => {
  mount();
  await screen.findByText("José Real");
  // Scoped to the members list: the owner's invitations card below reserves its own slot (rules §12).
  expect(document.querySelector("[data-pf-team-workspace] [data-pf-action-status-slot]")).toBeNull();
});
it("keeps diacritic-insensitive name/email search and clears empty results", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.type(screen.getByRole("searchbox"), "JOSE");
  expect(screen.queryByText("Ana Real")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox")); await user.type(screen.getByRole("searchbox"), "missing");
  expect(screen.getByRole("heading", { name: "Sin resultados", level: 2 })).toBeVisible();
  expect(screen.getByText("No hay miembros que coincidan con “missing”.")).toBeVisible();
  expect(document.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
  expect(screen.getByText("Ana Real")).toBeInTheDocument();
});
it("shows deleted users without inventing contact or workload", async () => {
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: [{ ...members[1], user: null }] });
  mount(); await screen.findByText("Usuario dado de baja");
  expect(screen.queryByText("jose@example.test")).not.toBeInTheDocument();
  expect(screen.getByText("Carga no disponible")).toBeInTheDocument();
});
it("derives workload from all draft pages by user id", async () => {
  vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: true, items: [draft("a")], nextCursor: "opaque" }).mockResolvedValueOnce({ ok: true, items: [draft("b", { status: "paused" }), draft("c", { status: "closed" }), draft("d", { process: "finished" })], nextCursor: null });
  mount();
  expect(await screen.findByText("2 vacantes · 6 candidatos en proceso")).toBeInTheDocument();
  expect(listDraftsAction).toHaveBeenNthCalledWith(2, { limit: 50, cursor: "opaque" });
});
it("shows a skeleton, never zero workload, until drafts finish loading", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof listDraftsAction>>) => void;
  vi.mocked(listDraftsAction).mockReturnValue(new Promise(done => { resolve = done; }));
  mount(); await screen.findByText("José Real");
  expect(row(members[1].id).querySelector('[data-pf-team-workload] [data-slot="skeleton"]')).toBeInTheDocument();
  expect(within(row(members[1].id)).queryByText(/Sin vacantes/)).not.toBeInTheDocument();
  await act(async () => resolve({ ok: true, items: [], nextCursor: null }));
  expect(within(row(members[1].id)).getByText("Sin vacantes asignadas")).toBeInTheDocument();
});
it("does not report partial/failed drafts as zero and offers a read retry", async () => {
  vi.mocked(listDraftsAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } });
  mount(); await screen.findByText("José Real");
  expect(await screen.findByText("No pudimos cargar la carga de trabajo")).toBeInTheDocument();
  expect(within(row(members[1].id)).getByText("Carga no disponible")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar carga" }));
  expect(await screen.findByText("2 vacantes · 6 candidatos en proceso")).toBeInTheDocument();
});
it("owners get other-member menus, never their own", async () => {
  mount(); await screen.findByText("José Real");
  expect(screen.getByRole("button", { name: "Acciones de José Real" })).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.queryByRole("button", { name: "Acciones de Ana Real" })).not.toBeInTheDocument();
});
it.each(["recruiter", null] as const)("hides all actions for membership %s", async role => {
  vi.mocked(useCompanyMembership).mockReturnValue(role ? { ...membership!, role } : null);
  mount(); await screen.findByText("José Real");
  expect(screen.queryByRole("button", { name: /Acciones de/ })).not.toBeInTheDocument();
});
it("hides the only owner's menu even if the current membership says owner", async () => {
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: [members[1], { ...members[0], user: { ...members[0].user, id: "10000000-0000-4000-8000-000000000099" } }] });
  mount(); await screen.findByText("Ana Real");
  expect(screen.queryByRole("button", { name: "Acciones de Ana Real" })).not.toBeInTheDocument();
});
it("confirms role change, writes member id, disables pending controls and refreshes", async () => {
  const user = userEvent.setup(); let resolve!: (value: { ok: true }) => void;
  vi.mocked(changeTeamRoleAction).mockReturnValue(new Promise(done => { resolve = done; }));
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: true, members }).mockResolvedValueOnce({ ok: true, members: members.map(member => ({ ...member, role: "owner" })) });
  mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(await screen.findByRole("menuitem", { name: "Hacer dueño" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/José Real/)).toBeInTheDocument();
  expect(changeTeamRoleAction).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cambiar rol" }));
  expect(changeTeamRoleAction).toHaveBeenCalledExactlyOnceWith(members[1].id, "owner");
  expect(within(dialog).getByRole("button", { name: "Guardando…" })).toBeDisabled();
  await act(async () => resolve({ ok: true }));
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Rol actualizado")).toBeInTheDocument();
  expect(within(row(members[1].id)).getByText("Dueño")).toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});
it("confirms removal naming the person and refreshes after DELETE", async () => {
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: true, members }).mockResolvedValueOnce({ ok: true, members: [members[0]] });
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(await screen.findByRole("menuitem", { name: "Quitar" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("heading")).toHaveTextContent("José Real");
  expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).toBeInTheDocument();
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Quitar del equipo" }));
  expect(removeTeamMemberAction).toHaveBeenCalledExactlyOnceWith(members[1].id);
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("José Real")).not.toBeInTheDocument();
  expect(screen.getByText("Miembro quitado del equipo")).toBeInTheDocument();
});
it("cancel never writes; failed writes keep persistent feedback and do not claim success", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  async function open() { await user.click(screen.getByRole("button", { name: "Acciones de José Real" })); await user.click(await screen.findByRole("menuitem", { name: "Quitar" })); }
  await open(); await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
  await open(); await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar del equipo" }));
  expect(await screen.findByText("No tienes permiso para esta acción")).toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 403 }) }));
  expect(listTeamMembersAction).toHaveBeenCalledTimes(1);
});
it.each([["unauthenticated", "Tu sesión expiró"], ["not_member", "No perteneces a esta empresa"], ["server_error", "No pudimos cargar el equipo"]] as const)("renders %s failure with retry", async (reason, title) => {
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: false, reason, reference: {} });
  mount(); expect(await screen.findByText(title)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("José Real")).toBeInTheDocument();
});
it("shows loading skeletons and a genuine empty state", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof listTeamMembersAction>>) => void;
  vi.mocked(listTeamMembersAction).mockReturnValue(new Promise(done => { resolve = done; }));
  mount(); expect(screen.getByText("Cargando equipo")).toBeInTheDocument();
  expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  await act(async () => resolve({ ok: true, members: [] }));
  expect(screen.getByRole("heading", { name: "Todavía no hay miembros del equipo", level: 2 })).toBeVisible();
  expect(screen.getByText("Aquí verás quiénes tienen acceso a tu empresa y su carga de trabajo. No puedes agregar miembros desde esta pantalla; puedes revisar la configuración de tu empresa.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ver configuración" })).toHaveAttribute("href", "/empresa/configuracion");
  expect(document.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-muted");
  expect(screen.queryByRole("button", { name: "Invitar miembro" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
  expect(document.querySelector('[data-slot="card"] [data-slot="card"]')).not.toBeInTheDocument();
});
it("does not reference an absent action status from the row menu", async () => {
  mount(); await screen.findByText("José Real");
  const trigger = screen.getByRole("button", { name: "Acciones de José Real" });
  const statusId = trigger.getAttribute("aria-describedby");
  expect(statusId === null || document.getElementById(statusId) !== null).toBe(true);
});
it("a disappeared member is not misreported as lost company membership", async () => {
  const user = userEvent.setup();
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: false, reason: "not_member", reference: { status: 404 } });
  mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar del equipo" }));
  expect(await screen.findByText("El miembro ya no está disponible")).toBeInTheDocument();
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
});
it("reconciles an uncertain mutation once without replaying it", async () => {
  const user = userEvent.setup();
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar del equipo" }));
  expect(await screen.findByText("No pudimos confirmar el cambio")).toBeInTheDocument();
  expect(listTeamMembersAction).toHaveBeenCalledTimes(2);
  expect(removeTeamMemberAction).toHaveBeenCalledTimes(1);
});
it("clears prior account content synchronously and ignores its late reads", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof listTeamMembersAction>>) => void;
  vi.mocked(listTeamMembersAction).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ ok: true, members: [members[1]] });
  const view = mount();
  const nextIdentity: IdentityState = { ...identity, result: { ok: true, data: { role: "recruiter", user: members[1].user } } };
  view.rerender(<IdentityContext.Provider value={nextIdentity}><TeamPage /></IdentityContext.Provider>);
  await screen.findByText("José Real");
  await act(async () => resolve({ ok: true, members }));
  expect(screen.queryByText("Ana Real")).not.toBeInTheDocument();
  view.rerender(<IdentityContext.Provider value={{ ...identity, status: "unauthenticated" }}><TeamPage /></IdentityContext.Provider>);
  expect(screen.queryByText("José Real")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/empresa/login");
});
it("does not show workload totals when the reused drafts reader reaches its cap", async () => {
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [draft("a")], nextCursor: "more" });
  mount();
  expect(await screen.findByText("La consulta no incluye todas las vacantes. No mostramos conteos incompletos.")).toBeInTheDocument();
  expect(within(row(members[1].id)).getByText("Carga no disponible")).toBeInTheDocument();
  expect(listDraftsAction).toHaveBeenCalledTimes(10);
});
it("explains the backend's last-owner guard and refreshes the list", async () => {
  const user = userEvent.setup();
  vi.mocked(changeTeamRoleAction).mockResolvedValue({ ok: false, reason: "last_owner", reference: { status: 409, code: "last_owner" } });
  mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(await screen.findByRole("menuitem", { name: "Hacer dueño" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cambiar rol" }));
  expect(await screen.findByText("La empresa debe conservar al menos un dueño")).toBeInTheDocument();
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
});
const stakeholder = { ...members[1], id: "20000000-0000-4000-8000-000000000005", role: "stakeholder" as const, user: { id: "10000000-0000-4000-8000-000000000005", full_name: "Jorge Treviño", email: "jorge@example.test" } };
it("lists a stakeholder with its label, no workload and only «Quitar» (D5), leaving recruiter rows as they were", async () => {
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: [...members, stakeholder] });
  const user = userEvent.setup(); mount(); await screen.findByText("Jorge Treviño");
  expect(within(row(stakeholder.id)).getByText("Stakeholder")).toBeInTheDocument();
  expect(within(row(stakeholder.id)).getByText("Solo ve Métricas")).toBeInTheDocument();
  expect(within(row(members[1].id)).getByText("Reclutador")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Acciones de Jorge Treviño" }));
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Quitar"]);
  await user.click(screen.getByRole("button", { name: "Acciones de Jorge Treviño" }));
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Hacer dueño", "Quitar"]);
});
it.each(["api", "1", ""])("removes a stakeholder with the plain DELETE, never the offboard preview (flag=%s)", async flag => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE", flag);
  const fixture = vi.spyOn(offboarding, "createOffboardFixtureClient");
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: true, members: [...members, stakeholder] }).mockResolvedValue({ ok: true, members });
  const user = userEvent.setup(); mount(); await screen.findByText("Jorge Treviño");
  await user.click(screen.getByRole("button", { name: "Acciones de Jorge Treviño" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "¿Quitar a Jorge Treviño del equipo?" })).toBeVisible();
  expect(within(dialog).getByText("Perderá el acceso a las Métricas de la empresa. Para volver a darle acceso, crea una invitación nueva.")).toBeVisible();
  expect(removeTeamMemberAction).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Quitar del equipo" }));
  expect(removeTeamMemberAction).toHaveBeenCalledExactlyOnceWith(stakeholder.id);
  expect(previewOffboardAction).not.toHaveBeenCalled();
  expect(fixture).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("Jorge Treviño")).not.toBeInTheDocument());
});
it("places the owner-only «Stakeholders» invitations card under the members list", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  mount();
  expect(await screen.findByRole("heading", { name: "Stakeholders" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Aún no hay stakeholders" })).toBeInTheDocument();
  const list = document.querySelector("[data-pf-team-workspace]")!;
  expect(list.compareDocumentPosition(document.querySelector("[data-pf-stakeholder-invitations]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("counts current stakeholders so the card skips the first-time empty state", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: [...members, stakeholder] });
  mount();
  expect(await screen.findByRole("heading", { name: "No hay invitaciones pendientes" })).toBeInTheDocument();
});
it("never shows the invitations card nor reads invitations for a recruiter", async () => {
  vi.mocked(useCompanyMembership).mockReturnValue({ ...membership, role: "recruiter" } as ReturnType<typeof useCompanyMembership>);
  mount(); await screen.findByText("José Real");
  expect(screen.queryByRole("heading", { name: "Stakeholders" })).toBeNull();
  expect(listStakeholderInvitationsAction).not.toHaveBeenCalled();
});
