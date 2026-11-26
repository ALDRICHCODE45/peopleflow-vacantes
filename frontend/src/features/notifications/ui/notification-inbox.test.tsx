import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({ getUnreadCountAction: vi.fn(), listNotificationsAction: vi.fn() }));
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  type Props = { href: string; onClick?: (event: { preventDefault(): void }) => void };
  // jsdom cannot navigate: keep the caller's onClick and stop the native follow.
  return { default: forwardRef<HTMLAnchorElement, Props>(({ href, onClick, ...props }, ref) =>
    createElement("a", { ...props, ref, href, onClick: (event: { preventDefault(): void }) => { onClick?.(event); event.preventDefault(); } })) };
});
import { getUnreadCountAction, listNotificationsAction } from "../actions";
import type { NotificationListResult } from "../model";
import {
  anaParticipation, applicationsGroup, jobId, luisParticipation, notificationPage, otherJobId, overdueGroup, reassignedGroup,
} from "../test-fixtures";
import { NotificationBell } from "./notification-bell";

const list = vi.mocked(listNotificationsAction);
const ok = (page = notificationPage()): NotificationListResult => ({ ok: true, data: page });
const failure = (reason: "server_error" | "invalid_cursor"): NotificationListResult => ({ ok: false, reason, reference: {} });

beforeEach(() => {
  vi.resetAllMocks();
  // 2026-11-26 14:00 in Mexico City; only Date is faked so polling and user events keep real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  vi.mocked(getUnreadCountAction).mockResolvedValue({ ok: true, data: { unread_count: 2, unread_notifications: 4 } });
  list.mockResolvedValue(ok());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openInbox() {
  const user = userEvent.setup();
  render(<NotificationBell />);
  await user.click(await screen.findByRole("button", { name: /^Notificaciones/ }));
  const dialog = await screen.findByRole("dialog", { name: "Notificaciones" });
  return { user, dialog };
}
const loaded = (dialog: HTMLElement) => within(dialog).findByRole("heading", { name: "Hoy" });

it("opens on the unread tab and summarises unread and attention", async () => {
  const { dialog } = await openInbox();
  await loaded(dialog);
  expect(list).toHaveBeenCalledWith({ state: "unread" });
  expect(within(dialog).getByText("2 sin leer · 1 requiere atención")).toBeInTheDocument();
  const unreadTab = within(dialog).getByRole("tab", { name: /No leídas/ });
  expect(unreadTab).toHaveAttribute("aria-selected", "true");
  expect(unreadTab).toHaveTextContent("2");
  expect(within(dialog).getByRole("tab", { name: "Todas" })).toHaveAttribute("aria-selected", "false");
});

it("pins «Requiere atención» with its total and the overdue badge", async () => {
  const { dialog } = await openInbox();
  const attention = await within(dialog).findByRole("region", { name: /Requiere atención/ });
  expect(attention).toHaveTextContent("1");
  const row = within(attention).getByRole("link", { name: /La entrega de Analista de nómina está vencida/ });
  expect(row).toHaveAttribute("href", `/empresa/vacantes/${jobId}/configuracion/entrega`);
  expect(row).toHaveTextContent("No leída.");
  expect(within(row).getByText("Vencida")).toBeInTheDocument();
  expect(row).toHaveTextContent("Entrega");
  expect(row).toHaveTextContent("Fecha compromiso: miércoles 25 de noviembre");
});

it("groups rows by day in Mexico City", async () => {
  list.mockResolvedValue(ok(notificationPage({
    items: [
      applicationsGroup(),
      reassignedGroup({ latest_at: "2026-11-25T18:00:00Z" }),
      reassignedGroup({ group_key: "n:old", latest_at: "2026-11-23T18:00:00Z" }),
    ],
  })));
  const { dialog } = await openInbox();
  await loaded(dialog);
  const headings = within(dialog).getAllByRole("heading", { level: 3 }).map(h => h.textContent);
  expect(headings).toEqual([expect.stringContaining("Requiere atención"), "Hoy", "Ayer", "Lunes 23 de noviembre"]);
});

it("renders rows as links with copy, relative time and destination", async () => {
  const { dialog } = await openInbox();
  await loaded(dialog);
  const group = within(dialog).getByRole("link", { name: /5 postulaciones nuevas en Analista de nómina/ });
  expect(group).toHaveAttribute("href", `/empresa/vacantes/${jobId}/pipeline`);
  expect(group).toHaveTextContent("No leída.");
  expect(group).toHaveTextContent("Ana López, Candidato y 3 más");
  expect(group).toHaveTextContent(/hace 1 hora/);
  expect(group).toHaveTextContent("Pipeline");

  const read = within(dialog).getByRole("link", { name: /Ahora eres responsable de Ejecutivo de ventas/ });
  expect(read).toHaveAttribute("href", `/empresa/vacantes/${otherJobId}/pipeline`);
  expect(read).not.toHaveTextContent("No leída.");
});

it("keeps a row without link as plain text", async () => {
  list.mockResolvedValue(ok(notificationPage({ items: [reassignedGroup({ type: "vacancy_unassigned", link: null })] })));
  const { dialog } = await openInbox();
  await loaded(dialog);
  expect(within(dialog).getByText("Ya no eres responsable de Ejecutivo de ventas")).toBeInTheDocument();
  expect(within(dialog).queryByRole("link", { name: /Ya no eres responsable/ })).toBeNull();
});

it("expands a group's sample with links to each candidate", async () => {
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  const toggle = within(dialog).getByRole("button", { name: "Ver los últimos 2" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveAccessibleName("Ocultar");
  expect(within(dialog).getByRole("link", { name: "Ana López" })).toHaveAttribute("href", `/empresa/vacantes/${jobId}/pipeline?candidato=${anaParticipation}`);
  expect(within(dialog).getByRole("link", { name: "Candidato" })).toHaveAttribute("href", `/empresa/vacantes/${jobId}/pipeline?candidato=${luisParticipation}`);
  await user.click(toggle);
  expect(within(dialog).queryByRole("link", { name: "Ana López" })).toBeNull();
});

it("switches to «Todas» and reads the whole inbox", async () => {
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  await user.click(within(dialog).getByRole("tab", { name: "Todas" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "all" }));
  expect(within(dialog).getByRole("tab", { name: "Todas" })).toHaveAttribute("aria-selected", "true");
});

it("loads more with the cursor, keeps attention from the first page only", async () => {
  list.mockResolvedValueOnce(ok(notificationPage({ next_cursor: "c1" })))
    .mockResolvedValueOnce(ok(notificationPage({ attention: null, attention_total: null, items: [reassignedGroup({ group_key: "n:more", latest_at: "2026-11-24T18:00:00Z" })], next_cursor: null })));
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Cargar más" }));
  await within(dialog).findByRole("heading", { name: "Martes 24 de noviembre" });
  expect(list).toHaveBeenLastCalledWith({ state: "unread", cursor: "c1" });
  expect(within(dialog).getAllByRole("link", { name: /está vencida/ })).toHaveLength(1);
  expect(within(dialog).getByRole("region", { name: /Requiere atención/ })).toHaveTextContent("1");
  expect(within(dialog).queryByRole("button", { name: "Cargar más" })).toBeNull();
});

it("reloads from the first page when the cursor is no longer valid", async () => {
  list.mockResolvedValueOnce(ok(notificationPage({ next_cursor: "stale" })))
    .mockResolvedValueOnce(failure("invalid_cursor"))
    .mockResolvedValueOnce(ok(notificationPage({ items: [applicationsGroup()] })));
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Cargar más" }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  expect(list).toHaveBeenLastCalledWith({ state: "unread" });
  await waitFor(() => expect(within(dialog).queryByRole("link", { name: /Ahora eres responsable/ })).toBeNull());
  expect(within(dialog).getByRole("link", { name: /5 postulaciones nuevas/ })).toBeInTheDocument();
});

it("says when more could not load and lets you retry", async () => {
  list.mockResolvedValueOnce(ok(notificationPage({ next_cursor: "c1" }))).mockResolvedValueOnce(failure("server_error"));
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Cargar más" }));
  expect(await within(dialog).findByText("No pudimos cargar más notificaciones.")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: /5 postulaciones nuevas/ })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Cargar más" })).toBeInTheDocument();
});

it("shows a skeleton with a status while loading", async () => {
  list.mockReturnValue(new Promise(() => {}));
  const { dialog } = await openInbox();
  expect(within(dialog).getByRole("status")).toHaveTextContent("Cargando notificaciones");
  expect(within(dialog).getByText("Cargando…")).toBeInTheDocument();
});

it("explains the first use on «Todas»", async () => {
  list.mockResolvedValueOnce(ok(notificationPage({ attention: [], attention_total: 0, items: [], unread_count: 0 })))
    .mockResolvedValueOnce(ok(notificationPage({ attention: [], attention_total: 0, items: [], unread_count: 0 })));
  const { user, dialog } = await openInbox();
  await user.click(await within(dialog).findByRole("button", { name: "Ver todas" }));
  expect(await within(dialog).findByRole("heading", { name: "Aún no tienes notificaciones" })).toBeInTheDocument();
  expect(within(dialog).getByText("Todo leído")).toBeInTheDocument();
});

it("says you are up to date on an empty unread tab and offers «Ver todas»", async () => {
  list.mockResolvedValueOnce(ok(notificationPage({ attention: [], attention_total: 0, items: [], unread_count: 0 })));
  const { user, dialog } = await openInbox();
  expect(await within(dialog).findByRole("heading", { name: "Estás al día" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Ver todas" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "all" }));
  expect(within(dialog).getByRole("tab", { name: "Todas" })).toHaveAttribute("aria-selected", "true");
});

it("shows the error with «Reintentar» and reads again", async () => {
  list.mockResolvedValueOnce(failure("server_error"));
  const { user, dialog } = await openInbox();
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("No pudimos cargar tus notificaciones.");
  await user.click(within(dialog).getByRole("button", { name: "Reintentar" }));
  await loaded(dialog);
  expect(list).toHaveBeenCalledTimes(2);
});

it("shows an empty inbox, not an error, to a user the inbox refuses (no company yet)", async () => {
  list.mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
  const { user, dialog } = await openInbox();
  expect(await within(dialog).findByRole("heading", { name: "Estás al día" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Ver todas" }));
  expect(await within(dialog).findByRole("heading", { name: "Aún no tienes notificaciones" })).toBeInTheDocument();
});

it("closes the sheet when a row is followed", async () => {
  const { user, dialog } = await openInbox();
  await loaded(dialog);
  await user.click(within(dialog).getByRole("link", { name: /5 postulaciones nuevas/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("has no «Preferencias» link until the preferences page exists", async () => {
  const { dialog } = await openInbox();
  await loaded(dialog);
  expect(within(dialog).queryByRole("link", { name: /Preferencias/ })).toBeNull();
});

it("renders the attention overdue group pinned and not again in the day list", async () => {
  list.mockResolvedValue(ok(notificationPage({ items: [applicationsGroup()], attention: [overdueGroup()] })));
  const { dialog } = await openInbox();
  await loaded(dialog);
  expect(within(dialog).getAllByRole("link", { name: /está vencida/ })).toHaveLength(1);
});
