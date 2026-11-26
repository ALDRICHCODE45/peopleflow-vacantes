import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// The bell reads the candidate inbox through server actions; the header only needs a stable count.
vi.mock("@/features/notifications/actions", () => ({
  getCandidateUnreadCountAction: vi.fn(async () => ({ ok: true, data: { unread_count: 3, unread_notifications: 3 } })),
  listCandidateNotificationsAction: vi.fn(async () => ({ ok: false, reason: "no_response", reference: {} })),
  getUnreadCountAction: vi.fn(),
  listNotificationsAction: vi.fn(),
}));
const { identityMock } = vi.hoisted(() => ({ identityMock: vi.fn() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => identityMock() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/candidato/dashboard", useSearchParams: () => null }));

import { getCandidateUnreadCountAction, getUnreadCountAction } from "@/features/notifications/actions";
import { CandidateHeader } from "./candidate-header";
import { SidebarProvider } from "@/components/company-dashboard/ui/sidebar";

const candidate = { status: "ready", result: { ok: true, data: { role: "candidate", user: { id: "id", full_name: "Ana Pérez", email: "ana@example.com" } } } };
const visitor = { status: "unauthenticated", result: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderHeader = () => render(<SidebarProvider><CandidateHeader title="Postulaciones" /></SidebarProvider>);

describe("candidate header notification bell (T3.6, design 04)", () => {
  it("mounts one candidate bell right before the theme toggle", async () => {
    identityMock.mockReturnValue(candidate);
    renderHeader();
    const header = document.querySelector("header")!;
    const bell = await within(header).findByRole("button", { name: "Notificaciones, 3 sin leer" });
    expect(within(header).getAllByRole("button", { name: /^Notificaciones/ })).toHaveLength(1);
    expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    expect(bell.className).toMatch(/(^|\s)size-10(\s|$)/);
    const toggle = within(header).getByRole("button", { name: "Cambiar tema" });
    expect(bell.nextElementSibling).toBe(toggle);
    expect(getCandidateUnreadCountAction).toHaveBeenCalled();
    expect(getUnreadCountAction).not.toHaveBeenCalled();
  });

  it("shows no bell to a visitor or while the identity loads", () => {
    identityMock.mockReturnValue(visitor);
    renderHeader();
    expect(screen.queryByRole("button", { name: /^Notificaciones/ })).toBeNull();
    cleanup();
    identityMock.mockReturnValue({ status: "loading", result: null });
    renderHeader();
    expect(screen.queryByRole("button", { name: /^Notificaciones/ })).toBeNull();
    expect(getCandidateUnreadCountAction).not.toHaveBeenCalled();
  });
});
