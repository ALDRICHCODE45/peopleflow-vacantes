import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { FacetsResult, MarkResultResult, NotificationListResult } from "../model";
import { markResult, notificationFacets, notificationPage } from "../test-fixtures";
import { NotificationBell } from "./notification-bell";

/** Shared steps of the inbox UI tests; each test file mocks `../actions` and `next/link` itself. */

export const ok = (page = notificationPage()): NotificationListResult => ({ ok: true, data: page });
export const marked = (overrides: Parameters<typeof markResult>[0] = {}): MarkResultResult => ({ ok: true, data: markResult(overrides) });
export const facets = (overrides: Parameters<typeof notificationFacets>[0] = {}): FacetsResult => ({ ok: true, data: notificationFacets(overrides) });

/** jsdom lacks matchMedia, ResizeObserver and PointerEvent, which Base UI reads (positioner, checkbox clicks). */
export function stubBrowserApis() {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

export async function openInbox() {
  const user = userEvent.setup();
  render(<NotificationBell />);
  await user.click(await screen.findByRole("button", { name: /^Notificaciones/ }));
  const dialog = await screen.findByRole("dialog", { name: "Notificaciones" });
  await within(dialog).findByRole("heading", { name: "Hoy" });
  return { user, dialog };
}

/** The `<li>` of the row whose link matches `name`. */
export function rowOf(dialog: HTMLElement, name: RegExp): HTMLElement {
  return within(dialog).getByRole("link", { name }).closest("li")!;
}
