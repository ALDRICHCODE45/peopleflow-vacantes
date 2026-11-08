import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("./actions", () => ({ listStakeholderInvitationsAction: vi.fn(), createStakeholderInvitationAction: vi.fn(), revokeStakeholderInvitationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { createStakeholderInvitationAction, listStakeholderInvitationsAction, revokeStakeholderInvitationAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { StakeholderInvitationsCard } from "./invitations-card";
import { createdInvitation, invitationId, ownerUserId, pendingInvitation, secondInvitationId, urlToken } from "./test-fixtures";

const owner = { user: { id: ownerUserId, full_name: "Sofía Ramírez" } };
const link = `${window.location.origin}/empresa/invitacion/${urlToken}`;
const writeText = vi.fn<(value: string) => Promise<void>>();
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-07T16:42:00Z") });
});
/** user-event installs its own clipboard stub on setup; the browser double replaces it afterwards. */
function setupUser() {
  const user = userEvent.setup({ advanceTimers: () => {} });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return user;
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = (stakeholderCount = 0) => render(<StakeholderInvitationsCard members={[owner]} stakeholderCount={stakeholderCount} />);
const many = (count: number) => Array.from({ length: count }, (_, i) => pendingInvitation({ id: `80000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));

it("explains the role and offers one entry when there are no stakeholders nor invitations", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  mount();
  expect(await screen.findByRole("heading", { name: "Aún no hay stakeholders" })).toBeInTheDocument();
  expect(screen.getByText("Un stakeholder ve las métricas de la empresa en solo lectura, por ejemplo un director. Crea un enlace y envíaselo.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Crear enlace de invitación" })).toHaveLength(1);
});

it("lists pending invitations by creation date, creator resolved from members, expiry and count of 20", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [pendingInvitation(), pendingInvitation({ id: secondInvitationId, created_by: "10000000-0000-4000-8000-0000000000ff", created_at: "2026-11-07T16:42:00Z", expires_at: "2026-11-14T16:42:00Z" })] });
  mount(1);
  const table = await screen.findByRole("table", { name: "Invitaciones pendientes" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText("5 nov 2026, 09:14")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Sofía Ramírez")).toBeInTheDocument();
  expect(within(rows[0]).getByText("12 nov 2026")).toBeInTheDocument();
  expect(within(rows[0]).getByText("en 5 días")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Ex miembro")).toBeInTheDocument();
  expect(screen.getByText("2 de 20")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revocar invitación del 5 nov 2026, 09:14" })).toBeInTheDocument();
  expect(screen.getByText(/Por seguridad el enlace no se vuelve a mostrar/)).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(urlToken);
});

it("disables creation at 20 pending invitations and keeps the reason visible next to the button", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: many(20) });
  mount(1);
  const button = await screen.findByRole("button", { name: "Crear enlace de invitación" });
  expect(button).toBeDisabled();
  const reason = screen.getByText("Tienes 20 invitaciones pendientes, el máximo. Revoca alguna que ya no uses para crear otra.");
  expect(button).toHaveAttribute("aria-describedby", reason.closest("[id]")!.id);
});

it("shows the link once with an honest copy button, then refreshes the list", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValueOnce({ ok: true, items: [] }).mockResolvedValue({ ok: true, items: [pendingInvitation({ id: invitationId, created_at: "2026-11-07T16:42:00Z" })] });
  vi.mocked(createStakeholderInvitationAction).mockResolvedValue({ ok: true, invitation: createdInvitation() });
  writeText.mockResolvedValue();
  const user = setupUser();
  mount();
  await user.click(await screen.findByRole("button", { name: "Crear enlace de invitación" }));
  const dialog = await screen.findByRole("dialog", { name: "Copia el enlace ahora" });
  expect(within(dialog).getByText("Por seguridad no lo volveremos a mostrar. Envíalo por WhatsApp o chat a la persona que quieres invitar. Sirve una sola vez y vence el 14 nov 2026 a las 10:42.")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Enlace de invitación")).toHaveValue(link);
  expect(within(dialog).getByText("Quien use este enlace verá las métricas de toda la empresa y los nombres de candidatos en el detalle auditado.")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Copiar enlace" }));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(link);
  expect(await within(dialog).findByText("Enlace copiado. Pégalo en el mensaje para la persona invitada.")).toBeInTheDocument();
  await waitFor(() => expect(listStakeholderInvitationsAction).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Nueva")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Listo, ya lo copié" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.textContent).not.toContain(urlToken);
  expect(createStakeholderInvitationAction).toHaveBeenCalledTimes(1);
});

it("says so when the browser refuses to copy and leaves the link selected", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(createStakeholderInvitationAction).mockResolvedValue({ ok: true, invitation: createdInvitation() });
  writeText.mockRejectedValue(new Error("denied"));
  const user = setupUser();
  mount();
  await user.click(await screen.findByRole("button", { name: "Crear enlace de invitación" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Copiar enlace" }));
  expect(await within(dialog).findByText("No se pudo copiar. El enlace quedó seleccionado: cópialo con Ctrl+C.")).toBeInTheDocument();
  const input = within(dialog).getByLabelText("Enlace de invitación") as HTMLInputElement;
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
  expect(within(dialog).queryByText(/Enlace copiado/)).toBeNull();
});

it("reports the 422 limit without showing a link and re-reads the list", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(createStakeholderInvitationAction).mockResolvedValue({ ok: false, reason: "limit_reached", reference: { status: 422, code: "invitation_limit_reached" } });
  const user = setupUser();
  mount();
  await user.click(await screen.findByRole("button", { name: "Crear enlace de invitación" }));
  expect(await screen.findByText("Llegaste al máximo de 20 invitaciones pendientes. Revoca alguna para crear otra.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(listStakeholderInvitationsAction).toHaveBeenCalledTimes(2);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No se creó el enlace", reference: expect.objectContaining({ status: 422, code: "invitation_limit_reached" }) }));
});

it("never claims a link on an uncertain create and tells the owner how to recover", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(createStakeholderInvitationAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  const user = setupUser();
  mount();
  await user.click(await screen.findByRole("button", { name: "Crear enlace de invitación" }));
  expect(await screen.findByText("No pudimos confirmar si se creó el enlace. Si aparece una invitación nueva en la lista, revócala y crea otra.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(createStakeholderInvitationAction).toHaveBeenCalledTimes(1);
  expect(listStakeholderInvitationsAction).toHaveBeenCalledTimes(2);
});

it("revokes only after confirming, then re-reads the list", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValueOnce({ ok: true, items: [pendingInvitation()] }).mockResolvedValue({ ok: true, items: [] });
  vi.mocked(revokeStakeholderInvitationAction).mockResolvedValue({ ok: true });
  const user = setupUser();
  mount(1);
  await user.click(await screen.findByRole("button", { name: "Revocar invitación del 5 nov 2026, 09:14" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "¿Revocar la invitación del 5 nov 2026, 09:14?" })).toBeInTheDocument();
  expect(within(dialog).getByText("El enlace deja de funcionar de inmediato. Si la persona todavía no se une, tendrás que enviarle uno nuevo.")).toBeInTheDocument();
  expect(revokeStakeholderInvitationAction).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Revocar invitación" }));
  expect(revokeStakeholderInvitationAction).toHaveBeenCalledExactlyOnceWith(invitationId);
  expect(await screen.findByText("Invitación revocada")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "No hay invitaciones pendientes" })).toBeInTheDocument();
});

it("cancelling a revocation writes nothing", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [pendingInvitation()] });
  const user = setupUser();
  mount(1);
  await user.click(await screen.findByRole("button", { name: "Revocar invitación del 5 nov 2026, 09:14" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
  expect(revokeStakeholderInvitationAction).not.toHaveBeenCalled();
  expect(screen.getByText("Sofía Ramírez")).toBeInTheDocument();
  expect(listStakeholderInvitationsAction).toHaveBeenCalledTimes(1);
});

it("keeps the invitation and says so when a revocation fails", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValue({ ok: true, items: [pendingInvitation()] });
  vi.mocked(revokeStakeholderInvitationAction).mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
  const user = setupUser();
  mount(1);
  await user.click(await screen.findByRole("button", { name: "Revocar invitación del 5 nov 2026, 09:14" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revocar invitación" }));
  expect(await screen.findByText("No se revocó la invitación")).toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No se revocó la invitación", description: "Solo la persona dueña de la cuenta puede revocar invitaciones. El enlace sigue activo." }));
  expect(screen.getByText("Sofía Ramírez")).toBeInTheDocument();
});

it("offers a retry when the list cannot be read", async () => {
  vi.mocked(listStakeholderInvitationsAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } }).mockResolvedValue({ ok: true, items: [] });
  const user = setupUser();
  mount();
  expect(await screen.findByText("No pudimos cargar las invitaciones. Es seguro reintentar.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { name: "Aún no hay stakeholders" })).toBeInTheDocument();
});
