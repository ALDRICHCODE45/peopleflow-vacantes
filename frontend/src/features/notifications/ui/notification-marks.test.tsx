import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  getUnreadCountAction: vi.fn(), listNotificationsAction: vi.fn(), markReadAction: vi.fn(), markUnreadAction: vi.fn(),
  markAllReadAction: vi.fn(), getFacetsAction: vi.fn(),
}));
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  type Props = { href: string; onClick?: (event: { preventDefault(): void }) => void };
  return { default: forwardRef<HTMLAnchorElement, Props>(({ href, onClick, ...props }, ref) =>
    createElement("a", { ...props, ref, href, onClick: (event: { preventDefault(): void }) => { onClick?.(event); event.preventDefault(); } })) };
});
import { getUnreadCountAction, listNotificationsAction, markAllReadAction, markReadAction, markUnreadAction } from "../actions";
import { applicationsGroup, notificationPage, overdueGroup } from "../test-fixtures";
import { marked, ok, openInbox, rowOf, stubBrowserApis } from "./inbox-harness";

const list = vi.mocked(listNotificationsAction);
const markRead = vi.mocked(markReadAction);
const markAll = vi.mocked(markAllReadAction);
const markUnread = vi.mocked(markUnreadAction);
const bell = (name: string | RegExp) => screen.getByRole("button", { name, hidden: true });
const applications = /5 postulaciones nuevas/;

beforeEach(() => {
  vi.resetAllMocks();
  stubBrowserApis();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  vi.mocked(getUnreadCountAction).mockResolvedValue({ ok: true, data: { unread_count: 2, unread_notifications: 4 } });
  list.mockResolvedValue(ok());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("marks one group read and keeps it visible as read on «No leídas», updating the bell", async () => {
  markRead.mockResolvedValue(marked({ unread_count: 1, affected_notifications: 3 }));
  const { user, dialog } = await openInbox();
  const row = rowOf(dialog, applications);
  await user.click(within(row).getByRole("button", { name: "Marcar como leída" }));
  expect(markRead).toHaveBeenCalledWith({ groupKeys: [applicationsGroup().group_key] });
  await waitFor(() => expect(within(dialog).getByRole("link", { name: applications })).not.toHaveTextContent("No leída."));
  expect(within(rowOf(dialog, applications)).queryByRole("button", { name: "Marcar como leída" })).toBeNull();
  expect(within(dialog).getByRole("tab", { name: /No leídas/ })).toHaveTextContent("1");
  expect(bell("Notificaciones, 1 sin leer")).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(1);
  expect(within(dialog).queryByRole("button", { name: "Deshacer" })).toBeNull();
});

it("marks an attention item read", async () => {
  markRead.mockResolvedValue(marked({ unread_count: 1 }));
  const { user, dialog } = await openInbox();
  const attention = within(dialog).getByRole("region", { name: /Requiere atención/ });
  await user.click(within(attention).getByRole("button", { name: "Marcar como leída" }));
  expect(markRead).toHaveBeenCalledWith({ groupKeys: [overdueGroup().group_key] });
  await waitFor(() => expect(within(attention).getByRole("link", { name: /está vencida/ })).not.toHaveTextContent("No leída."));
});

it("leaves the row unread and says so politely when the mark fails", async () => {
  markRead.mockResolvedValue({ ok: false, reason: "server_error", reference: {} });
  const { user, dialog } = await openInbox();
  await user.click(within(rowOf(dialog, applications)).getByRole("button", { name: "Marcar como leída" }));
  expect(await within(dialog).findByText("No se pudo marcar como leída.")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: applications })).toHaveTextContent("No leída.");
  expect(within(rowOf(dialog, applications)).getByRole("button", { name: "Marcar como leída" })).toBeInTheDocument();
  expect(bell("Notificaciones, 2 sin leer")).toBeInTheDocument();
});

it("marks the group read when its row is opened, without waiting for it", async () => {
  markRead.mockReturnValue(new Promise(() => {}));
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("link", { name: applications }));
  expect(markRead).toHaveBeenCalledWith({ groupKeys: [applicationsGroup().group_key] });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("still navigates when marking on open throws", async () => {
  markRead.mockImplementation(() => { throw new Error("boom"); });
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("link", { name: /está vencida/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("does not mark a read row on open", async () => {
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("link", { name: /Ahora eres responsable/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(markRead).not.toHaveBeenCalled();
});

it("marks all read up to the newest activity shown (server clock), reports it and undoes exactly that batch", async () => {
  markAll.mockResolvedValue(marked({ affected_notifications: 4, unread_count: 0, marked_at: "2026-11-26T20:05:00.5Z" }));
  markUnread.mockResolvedValue(marked({ affected_notifications: 4, unread_count: 2 }));
  const { user, dialog } = await openInbox();
  vi.setSystemTime(new Date("2026-11-26T20:05:00Z"));
  list.mockResolvedValue(ok(notificationPage({ attention: [], attention_total: 0, items: [], unread_count: 0 })));
  await user.click(within(dialog).getByRole("button", { name: "Marcar todo como leído" }));
  expect(markAll).toHaveBeenCalledWith({ before: "2026-11-26T18:41:10Z" });
  expect(await within(dialog).findByText("4 marcadas como leídas")).toBeInTheDocument();
  expect(bell("Notificaciones, todo leído")).toBeInTheDocument();
  await within(dialog).findByRole("heading", { name: "Estás al día" });
  expect(list).toHaveBeenCalledTimes(2);
  expect(within(dialog).queryByRole("button", { name: "Marcar todo como leído" })).toBeNull();

  list.mockResolvedValue(ok());
  await user.click(within(dialog).getByRole("button", { name: "Deshacer" }));
  expect(markUnread).toHaveBeenCalledWith({ markedAt: "2026-11-26T20:05:00.5Z" });
  await within(dialog).findByRole("link", { name: applications });
  expect(list).toHaveBeenCalledTimes(3);
  expect(within(dialog).queryByText("4 marcadas como leídas")).toBeNull();
  expect(bell("Notificaciones, 2 sin leer")).toBeInTheDocument();
});

it("says «1 marcada como leída» for a single notification", async () => {
  markAll.mockResolvedValue(marked({ affected_notifications: 1, unread_count: 0 }));
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("button", { name: "Marcar todo como leído" }));
  expect(await within(dialog).findByText("1 marcada como leída")).toBeInTheDocument();
});

it("keeps the list and says so when read-all fails", async () => {
  markAll.mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("button", { name: "Marcar todo como leído" }));
  expect(await within(dialog).findByText("No se pudo marcar todo como leído.")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: applications })).toHaveTextContent("No leída.");
  expect(within(dialog).queryByRole("button", { name: "Deshacer" })).toBeNull();
});

it("hides «Marcar todo como leído» when nothing is unread", async () => {
  list.mockResolvedValue(ok(notificationPage({ attention: [], attention_total: 0, items: [applicationsGroup({ read: true, unread_count: 0 })], unread_count: 0 })));
  const { dialog } = await openInbox();
  expect(within(dialog).queryByRole("button", { name: "Marcar todo como leído" })).toBeNull();
});
