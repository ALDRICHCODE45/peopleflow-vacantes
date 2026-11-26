import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({ getUnreadCountAction: vi.fn(), listNotificationsAction: vi.fn() }));
import { getUnreadCountAction, listNotificationsAction } from "../actions";
import { notificationPage } from "../test-fixtures";
import { NotificationBell } from "./notification-bell";

const unread = vi.mocked(getUnreadCountAction);
const list = vi.mocked(listNotificationsAction);
const count = (n: number) => ({ ok: true as const, data: { unread_count: n, unread_notifications: n } });

beforeEach(() => {
  vi.resetAllMocks();
  unread.mockResolvedValue(count(3));
  list.mockResolvedValue({ ok: true, data: notificationPage() });
});
afterEach(cleanup);

it("names the bell with the unread count and shows it as a badge", async () => {
  render(<NotificationBell />);
  const bell = await screen.findByRole("button", { name: "Notificaciones, 3 sin leer" });
  expect(bell).toHaveTextContent("3");
  expect(bell).toHaveAttribute("aria-haspopup", "dialog");
  expect(bell).toHaveAttribute("aria-expanded", "false");
});

it("caps the badge at 9+", async () => {
  unread.mockResolvedValue(count(12));
  render(<NotificationBell />);
  const bell = await screen.findByRole("button", { name: "Notificaciones, 12 sin leer" });
  expect(bell).toHaveTextContent("9+");
});

it("says everything is read and shows no badge at zero", async () => {
  unread.mockResolvedValue(count(0));
  render(<NotificationBell />);
  const bell = await screen.findByRole("button", { name: "Notificaciones, todo leído" });
  expect(bell).toHaveTextContent("");
});

it("is a plain «Notificaciones» button while the first count is unknown or unavailable", async () => {
  unread.mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
  render(<NotificationBell />);
  await waitFor(() => expect(unread).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Notificaciones" })).toBeInTheDocument();
});

it("opens the inbox sheet, and Escape closes it returning focus to the bell", async () => {
  const user = userEvent.setup();
  render(<NotificationBell />);
  const bell = await screen.findByRole("button", { name: "Notificaciones, 3 sin leer" });

  await user.click(bell);
  const dialog = await screen.findByRole("dialog", { name: "Notificaciones" });
  expect(dialog).toBeInTheDocument();
  expect(bell).toHaveAttribute("aria-expanded", "true");

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(bell).toHaveAttribute("aria-expanded", "false");
  await waitFor(() => expect(bell).toHaveFocus());
});

it("takes the unread count of a loaded page into the bell", async () => {
  const user = userEvent.setup();
  list.mockResolvedValue({ ok: true, data: notificationPage({ unread_count: 7 }) });
  render(<NotificationBell />);
  await user.click(await screen.findByRole("button", { name: "Notificaciones, 3 sin leer" }));
  await screen.findByRole("dialog", { name: "Notificaciones" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Notificaciones, 7 sin leer", hidden: true })).toBeInTheDocument());
});

it("reads the inbox again on every opening", async () => {
  const user = userEvent.setup();
  render(<NotificationBell />);
  const bell = await screen.findByRole("button", { name: /Notificaciones/ });
  await user.click(bell);
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(bell);
  await screen.findByRole("dialog");
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});
