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
vi.mock("./actions", () => ({ listTeamMembersAction: vi.fn(), changeTeamRoleAction: vi.fn(), removeTeamMemberAction: vi.fn() }));
vi.mock("@/features/employer-company/use-company-membership", () => ({ useCompanyMembership: vi.fn() }));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
import { TeamPage } from "@/features/employer-team/team-page";
import { listTeamMembersAction, changeTeamRoleAction, removeTeamMemberAction } from "@/features/employer-team/actions";
import { useCompanyMembership } from "@/features/employer-company/use-company-membership";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import { IdentityContext, type IdentityState } from "@/features/identity/identity-session";
import { notifyActionResult } from "@/components/feedback/notify";
import { members, selfId, draft } from "./test-fixtures";
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
  expect(document.querySelector("[data-pf-action-status-slot]")).toBeNull();
});
it("keeps diacritic-insensitive name/email search and clears empty results", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("José Real");
  await user.type(screen.getByRole("searchbox"), "JOSE");
  expect(screen.queryByText("Ana Real")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox")); await user.type(screen.getByRole("searchbox"), "missing");
  expect(screen.getByText("Sin resultados")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
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
  await user.click(await screen.findByRole("menuitem", { name: "Cambiar a Dueño" }));
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
  await user.click(await screen.findByRole("menuitem", { name: "Quitar del equipo" }));
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
  async function open() { await user.click(screen.getByRole("button", { name: "Acciones de José Real" })); await user.click(await screen.findByRole("menuitem", { name: "Quitar del equipo" })); }
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
  expect(screen.getByText("Todavía no hay miembros del equipo")).toBeInTheDocument();
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
  await user.click(screen.getByRole("menuitem", { name: "Quitar del equipo" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar del equipo" }));
  expect(await screen.findByText("El miembro ya no está disponible")).toBeInTheDocument();
  await waitFor(() => expect(listTeamMembersAction).toHaveBeenCalledTimes(2));
});
it("reconciles an uncertain mutation once without replaying it", async () => {
  const user = userEvent.setup();
  vi.mocked(removeTeamMemberAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  mount(); await screen.findByText("José Real");
  await user.click(screen.getByRole("button", { name: "Acciones de José Real" }));
  await user.click(screen.getByRole("menuitem", { name: "Quitar del equipo" }));
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
