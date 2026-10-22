import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IdentityContext, type IdentityState } from "./identity-session";
import { CandidateGuard, EmployerGuard } from "./area-guards";
import { CandidateSidebar } from "@/components/candidate-dashboard/candidate-sidebar";
import { AppSidebar } from "@/components/company-dashboard/app-sidebar";
import { SidebarProvider } from "@/components/company-dashboard/ui/sidebar";
import { CandidateNavUser } from "@/components/candidate-dashboard/candidate-nav-user";
vi.mock("next/navigation", () => ({ usePathname: () => "/candidato/perfil", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ loadMeAction: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
function identity(role: "candidate" | "recruiter" | null): IdentityState {
  return { status: "ready", email: null, retry: vi.fn(), update: vi.fn(), result: { ok: true, data: role === null ? { role, user: null } : { role, user: { id: "id", full_name: "Ana Pérez", email: "ana@example.com" } } } };
}
function mount(children: React.ReactNode, value: IdentityState) {
  return render(<IdentityContext.Provider value={value}><SidebarProvider>{children}</SidebarProvider></IdentityContext.Provider>);
}
it.each(["candidate", "employer"] as const)("%s guard keeps the page frame through checking, blocked and error states", area => {
  const Guard = area === "candidate" ? CandidateGuard : EmployerGuard;
  const blocked = identity(area === "candidate" ? "recruiter" : "candidate");
  const states: IdentityState[] = [
    { ...blocked, status: "loading", result: undefined },
    blocked,
    { ...blocked, result: { ok: false, reason: "identity_unavailable", reference: {} } },
  ];
  for (const value of states) {
    const { container, unmount } = mount(<Guard><p>Private</p></Guard>, value);
    expect(screen.getByRole("heading", { name: "Tu cuenta" })).toBeInTheDocument();
    expect(container.querySelector('header [data-slot="sidebar-trigger"]')).not.toBeNull();
    const content = container.querySelector("[data-pf-page-content]")!;
    expect(content).toHaveClass("flex-1", "items-center", "justify-center");
    const bounded = content.querySelector(".max-w-xl")!;
    expect(bounded).not.toBeNull();
    if (value.status !== "loading") expect(bounded.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(screen.queryByText("Private")).toBeNull();
    unmount();
  }
});
it("shows a recruiter name and email in the candidate account row", () => {
  mount(<CandidateNavUser />, identity("recruiter"));
  expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
  expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  expect(screen.queryByText("Mi cuenta")).toBeNull();
});
it.each(["candidate", "recruiter", null] as const)("candidate sidebar limits navigation for %s", role => {
  mount(<CandidateSidebar />, identity(role));
  expect(screen.getByRole("link", { name: "PeopleFlow" })).toBeInTheDocument();
  if (role === "candidate") expect(screen.getByText("Mi búsqueda")).toBeInTheDocument();
  else { expect(screen.queryByText("Mi búsqueda")).toBeNull(); expect(screen.queryByText("Mi perfil")).toBeNull(); }
});
it.each(["candidate", "recruiter", null] as const)("company sidebar limits navigation for %s", role => {
  mount(<AppSidebar />, identity(role));
  expect(screen.getByRole("link", { name: "PeopleFlow" })).toBeInTheDocument();
  if (role === "recruiter") expect(screen.getByText("Principal")).toBeInTheDocument();
  else { expect(screen.queryByText("Principal")).toBeNull(); expect(screen.queryByText("Organización")).toBeNull(); }
});
it("stacks the blocked actions full width on mobile instead of squeezing «Cerrar sesión» next to an empty status", () => {
  const { container } = mount(<CandidateGuard><p>Private</p></CandidateGuard>, identity("recruiter"));
  const actions = screen.getByRole("link", { name: "Ir a empresa" }).parentElement!;
  expect(actions.className).toContain("max-sm:[&_[data-pf-action-bar]]:flex-col-reverse");
  expect(actions.className).toContain("[&_[data-pf-action-bar-actions]]:w-full");
  expect(container.querySelector("[data-pf-action-bar]")).not.toBeNull();
});
