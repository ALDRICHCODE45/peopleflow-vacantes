import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const { pathnameMock, identityMock } = vi.hoisted(() => ({ pathnameMock: vi.fn(() => "/empresa/vacantes"), identityMock: { role: "candidate" } }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("@/features/identity/identity-session", () => ({
  useIdentity: () => ({ status: "ready", result: { ok: true, data: { role: identityMock.role, user: {
    id: "id", full_name: "Ana Pérez", email: "ana@example.com",
  } } } }),
}));

import { EmployerShell } from "./employer-shell";
import { CandidateShell } from "../candidate-dashboard/candidate-shell";
import { SidebarTrigger } from "./ui/sidebar";

function stubBrowserApis(innerWidth = 1280) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", innerWidth);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([
  ["employer", EmployerShell, "Nueva vacante", "button"],
  // T3 intentionally replaces the candidate GET action with a real Vacantes link.
  ["candidate", CandidateShell, "Vacantes", "link"],
] as const)("%s sidebar rail", (_name, Shell, actionLabel, actionRole) => {
  beforeEach(() => { identityMock.role = _name === "employer" ? "recruiter" : "candidate"; });
  it("replaces the wordmark with one accessible, unsqueezed compact brand mark", () => {
    stubBrowserApis();
    render(<Shell defaultOpen={false}>contenido</Shell>);
    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    const wordmark = brand.querySelector("[data-brand='wordmark']");
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(wordmark).toHaveClass("invisible", "opacity-0");
    // The 40px isotype fills the collapsed 40px button: no inherited brand padding clips it.
    expect(brand.className).toContain("group-data-[collapsible=icon]:data-[slot=sidebar-menu-button]:p-0!");
    const mark = within(brand).getByRole("img", { name: "PeopleFlow" });
    expect(mark).toHaveClass("size-10", "shrink-0");
    const isotypes = [...mark.querySelectorAll("img")].map(img => [img.getAttribute("src") ?? "", img.className]);
    expect(isotypes).toHaveLength(2);
    expect(isotypes[0][0]).toContain("peopleflow-mark-light.png");
    expect(isotypes[0][1]).toContain("brand-mark-light");
    expect(isotypes[1][0]).toContain("peopleflow-mark-dark.png");
    expect(isotypes[1][1]).toContain("brand-mark-dark");
    for (const img of mark.querySelectorAll("img")) expect(img).toHaveAttribute("alt", "");
    expect(mark).not.toHaveClass("invisible");
    for (const layer of [wordmark, mark]) {
      expect(layer).toHaveClass("transition-[opacity,visibility]", "duration-200", "ease-linear", "motion-reduce:transition-none");
    }
  });

  it("keeps brand, destinations and account inside one navigation landmark (axe region)", () => {
    stubBrowserApis();
    render(<Shell defaultOpen>contenido</Shell>);
    const landmark = screen.getByRole("navigation", { name: "Navegación principal" });
    for (const slot of ["sidebar-header", "sidebar-content", "sidebar-footer"]) {
      expect(landmark).toContainElement(document.querySelector<HTMLElement>(`[data-slot='${slot}']`));
    }
  });

  it("centers every 40px square and its contents, including action, active link and account", () => {
    pathnameMock.mockReturnValue(_name === "employer" ? "/empresa/vacantes" : "/candidato/postulaciones");
    stubBrowserApis();
    render(<Shell defaultOpen={false}>contenido</Shell>);
    // 40px target + the shared group's 8px inset on each side. The inset
    // variant adds its own outer padding; it must not shrink this inner rail.
    const wrapper = document.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    expect(wrapper.style.getPropertyValue("--sidebar-width-icon")).toBe("3.5rem");
    const footer = document.querySelector<HTMLElement>("[data-slot='sidebar-footer']")!;
    // The dropdown trigger owns data-slot on the composed account button.
    const account = within(footer).getByRole("button");
    const rows = [...document.querySelectorAll("[data-slot='sidebar-menu-button']"), account];
    expect(rows).toHaveLength(9); // brand, action (employer) or Vacantes (candidate), six destinations, account
    for (const row of rows) {
      expect(row).toHaveClass(
        "group-data-[collapsible=icon]:size-10!",
        "group-data-[collapsible=icon]:mx-auto",
        "group-data-[collapsible=icon]:justify-center",
        "group-data-[collapsible=icon]:gap-0",
        "group-data-[collapsible=icon]:p-0!",
        "group-data-[collapsible=icon]:rounded-lg",
        "focus-visible:ring-3",
      );
    }
    const active = screen.getByRole("link", { name: _name === "employer" ? "Vacantes" : "Postulaciones" });
    expect(active).toHaveAttribute("data-active");
    expect(active).toHaveClass("data-active:bg-sidebar-accent", "hover:bg-sidebar-accent");
    expect(active).toHaveAttribute("data-base-ui-tooltip-trigger");
    const action = screen.getByRole(actionRole, { name: actionLabel });
    if (actionRole === "link") expect(action).toHaveAttribute("href", "/vacantes");
    expect(action).toHaveAttribute("data-base-ui-tooltip-trigger");
    // The label (not the icon slot) collapses to screen-reader only.
    expect(within(action).getByText(actionLabel)).toHaveClass("group-data-[collapsible=icon]:sr-only");
    expect(account).toHaveAttribute("aria-haspopup", "menu");
    expect(account.querySelector("div.grid")).toHaveClass("group-data-[collapsible=icon]:sr-only");
    expect(account.querySelector("svg")).toHaveClass("group-data-[collapsible=icon]:hidden");
    expect(account.querySelector("[data-slot='avatar']")).toHaveClass("size-8");
  });

  it("keeps the full brand and labels in the mobile drawer even with a collapsed desktop preference", async () => {
    stubBrowserApis(375);
    const user = userEvent.setup();
    render(<Shell defaultOpen={false}><SidebarTrigger /></Shell>);
    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    const drawer = await screen.findByRole("dialog");
    const brand = within(drawer).getByRole("link", { name: "PeopleFlow" });
    expect(brand.querySelector("[data-brand='wordmark']")).toHaveAttribute("aria-hidden", "false");
    expect(brand.querySelector("[data-brand='mark']")).toHaveAttribute("aria-hidden", "true");
    expect(within(drawer).getByRole(actionRole, { name: actionLabel })).toBeInTheDocument();
    expect(drawer).not.toHaveAttribute("data-collapsible", "icon");
  });

  it("preserves the expanded wordmark, row sizing, brand padding and account summary", () => {
    stubBrowserApis();
    render(<Shell>contenido</Shell>);
    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    const wordmark = brand.querySelector("[data-brand='wordmark']");
    expect(wordmark).toHaveAttribute("aria-hidden", "false");
    expect(wordmark).not.toHaveClass("invisible");
    const mark = brand.querySelector("[data-brand='mark']");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("invisible", "opacity-0");
    expect(within(brand).getAllByRole("img", { name: "PeopleFlow" })).toHaveLength(2);
    expect(brand).toHaveClass("h-10", "data-[slot=sidebar-menu-button]:p-1.5!");
    for (const image of brand.querySelectorAll("[data-brand='wordmark'] img")) {
      expect(image).toHaveClass("h-6", "w-auto");
    }
    const action = screen.getByRole(actionRole, { name: actionLabel });
    expect(action).toHaveClass("h-10", "w-full", "px-3", "gap-2");
    const account = within(document.querySelector<HTMLElement>("[data-slot='sidebar-footer']")!).getByRole("button");
    expect(account).toHaveClass("h-12");
    expect(account.querySelector("div.grid")).not.toHaveClass("sr-only");
    expect(account.querySelector("svg")).not.toHaveClass("hidden");
  });
});
