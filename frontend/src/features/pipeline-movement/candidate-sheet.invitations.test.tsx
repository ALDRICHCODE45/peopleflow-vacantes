import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import { InvitationsProvider } from "@/features/psychometrics/sheet/state";
import * as actions from "@/features/psychometrics/actions";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { invitation, profile } from "@/features/psychometrics/fixtures.test";
import { invitationSchema, profileSchema, type Invitation } from "@/features/psychometrics/model";
vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn() }));
vi.mock("@/features/psychometrics/actions", () => ({ loadInvitationsAction: vi.fn(), loadProfileAction: vi.fn(), loadResultAction: vi.fn(), createComparisonAction: vi.fn(), createInvitationAction: vi.fn(), mintLinkAction: vi.fn(), remindInvitationAction: vi.fn(), revokeInvitationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({}) }));
// Replace only jsdom's portal/positioning boundary; retain the product menu and callbacks.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => { const [open, setOpen] = React.useState(false); return <Context.Provider value={{ open, setOpen }}>{children}</Context.Provider>; },
    DropdownMenuTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) => { const { setOpen } = React.useContext(Context); return React.cloneElement(render, { "aria-haspopup": "menu", onClick: () => setOpen(true), children } as ComponentProps<"button">); },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => { const { open, setOpen } = React.useContext(Context); return open ? <div role="menu" onClick={() => setOpen(false)}>{children}</div> : null; },
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuItem: ({ children, disabled, onClick }: ComponentProps<"button">) => <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
function menuAction(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Acciones de la invitación/ }));
  return screen.getByRole("menuitem", { name });
}
const current = (patch: Partial<Invitation> = {}): Invitation => ({ ...invitationSchema.parse(invitation), participation_id: boardFixture().participations[0].id, ...patch });
function Harness({ finished = false }: { finished?: boolean }) {
  const board = boardFixture();
  if (finished) board.lifecycle.process = "finished";
  return <InvitationsProvider vacancyId={vacancyId}><CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={() => {}} /></InvitationsProvider>;
}
async function openTab() { const tab = await screen.findByRole("tab", { name: "Psicometría" }); await act(async () => fireEvent.click(tab)); }
async function confirm(label: string) {
  const dialog = await screen.findByRole("alertdialog");
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: label })));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [current()] } });
  vi.mocked(actions.loadProfileAction).mockResolvedValue({ ok: true, data: profileSchema.parse({ ...profile, enabled: true }) });
  vi.mocked(actions.createInvitationAction).mockResolvedValue({ ok: true, data: current() });
  vi.mocked(actions.mintLinkAction).mockResolvedValue({ ok: true, data: { token: "private/link+token", expires_at: invitation.expires_at } });
  vi.mocked(actions.remindInvitationAction).mockResolvedValue({ ok: true, data: current({ reminder_count: 1, last_reminded_at: "2026-10-30T12:00:00Z" }) });
  vi.mocked(actions.revokeInvitationAction).mockResolvedValue({ ok: true, data: current({ status: "revoked" }) });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);
it.each(["Copiar enlace", "Recordar", "Revocar"])("invitation menu opens the existing %s confirmation without writing", async label => {
  render(<Harness />); await openTab();
  fireEvent.click(screen.getByRole("button", { name: /Acciones de la invitación/ }));
  const menu = await screen.findByRole("menu");
  for (const name of ["Copiar enlace", "Recordar", "Revocar"]) expect(within(menu).getByRole("menuitem", { name })).toBeVisible();
  fireEvent.click(within(menu).getByRole("menuitem", { name: label }));
  expect(within(await screen.findByRole("alertdialog")).getByRole("button", { name: label })).toBeVisible();
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  expect(actions.remindInvitationAction).not.toHaveBeenCalled();
  expect(actions.revokeInvitationAction).not.toHaveBeenCalled();
});
it("creates or adopts an existing invitation only after confirmation, without minting or sending email", async () => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<Harness />); await openTab();
  expect(screen.getByText("Aún no hay evaluación")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Enviar evaluación" }));
  expect(actions.createInvitationAction).not.toHaveBeenCalled();
  await confirm("Enviar evaluación");
  expect(await screen.findByRole("button", { name: /Acciones de la invitación/ })).toBeVisible();
  expect(menuAction("Copiar enlace")).toBeVisible();
  expect(actions.createInvitationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, participationId: boardFixture().participations[0].id });
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Invitación disponible" }));
});
it("copies only after revoke-previous confirmation and never renders the bearer", async () => {
  render(<Harness />); await openTab();
  fireEvent.click(menuAction("Copiar enlace"));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/El enlace anterior deja de funcionar/)).toBeVisible();
  expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  fireEvent.click(menuAction("Copiar enlace"));
  await confirm("Copiar enlace");
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/evaluacion/private%2Flink%2Btoken`));
  expect(actions.mintLinkAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: invitation.id });
  expect(document.body.innerHTML).not.toContain("private");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Enlace copiado" }));
});
it("records a reminder before minting and copying, retaining reminder metadata", async () => {
  render(<Harness />); await openTab();
  fireEvent.click(menuAction("Recordar"));
  expect(actions.remindInvitationAction).not.toHaveBeenCalled();
  await confirm("Recordar");
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  expect(actions.remindInvitationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: invitation.id });
  expect(vi.mocked(actions.remindInvitationAction).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(actions.mintLinkAction).mock.invocationCallOrder[0]);
  fireEvent.click(screen.getByRole("button", { name: "Detalles de la invitación" }));
  expect(screen.getByText("Último recordatorio").nextElementSibling).not.toHaveTextContent("Sin recordatorios");
  expect(actions.loadResultAction).not.toHaveBeenCalled();
});
it("revokes after confirmation, updates the shared status, and removes writable actions", async () => {
  render(<Harness />); await openTab();
  fireEvent.click(menuAction("Revocar"));
  expect(actions.revokeInvitationAction).not.toHaveBeenCalled();
  await confirm("Revocar");
  expect(await screen.findByText("Revocada")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copiar enlace" })).not.toBeInTheDocument();
  expect(actions.revokeInvitationAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: invitation.id });
});
it.each(["already_finished", "participation_inactive", "process_finished", "profile_disabled"] as const)("handles %s without minting, preserving state and offering configuration for disabled profiles", async reason => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  vi.mocked(actions.createInvitationAction).mockResolvedValue({ ok: false, reason, reference: { status: 409, code: reason } });
  render(<Harness />); await openTab();
  fireEvent.click(screen.getByRole("button", { name: "Enviar evaluación" })); await confirm("Enviar evaluación");
  expect(await screen.findByText("No se creó la invitación")).toBeVisible();
  expect(screen.getByText("Aún no hay evaluación")).toBeVisible();
  if (reason === "profile_disabled") expect(screen.getByRole("link", { name: "Configurar psicometría" })).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/configuracion/psicometria`);
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 409, code: reason }) }));
});
it("reports clipboard failure without retaining or displaying a token or claiming copy success", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("private/link+token"));
  render(<Harness />); await openTab(); fireEvent.click(menuAction("Copiar enlace")); await confirm("Copiar enlace");
  expect(await screen.findByText("No se copió el enlace")).toBeVisible();
  expect(document.body.innerHTML).not.toContain("private");
  expect(JSON.stringify(vi.mocked(notifyActionResult).mock.calls)).not.toContain("private");
  expect(notifyActionResult).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});
it("does not mint if the reminder fails, blocks uncertain replay until a read-only check", async () => {
  vi.mocked(actions.remindInvitationAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<Harness />); await openTab(); fireEvent.click(menuAction("Recordar")); await confirm("Recordar");
  expect(await screen.findByText("No se confirmó el recordatorio")).toBeVisible();
  expect(menuAction("Recordar")).toBeDisabled();
  expect(actions.mintLinkAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Comprobar invitación" }));
  await waitFor(() => expect(actions.loadInvitationsAction).toHaveBeenCalledTimes(2));
  expect(actions.remindInvitationAction).toHaveBeenCalledTimes(1);
});
it.each(["expired", "revoked"] as const)("%s retains metadata but never offers link or reminder", async status => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [current({ status, origin: "auto", trigger_stage_id: boardFixture().stages[1].id, created_by: null })] } });
  render(<Harness />); await openTab();
  fireEvent.click(screen.getByRole("button", { name: "Detalles de la invitación" }));
  expect(screen.getByText(/Automática · al entrar a/)).toBeVisible();
  expect(screen.getByText("Invitación")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Copiar enlace|Recordar|Revocar/ })).not.toBeInTheDocument();
  expect(actions.loadResultAction).not.toHaveBeenCalled();
});
it("keeps management read-only on a finished process", async () => {
  render(<Harness finished />); await openTab();
  menuAction("Copiar enlace");
  expect(screen.getByRole("menuitem", { name: "Copiar enlace" })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: "Recordar" })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: "Revocar" })).toBeDisabled();
});
