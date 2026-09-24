import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The shell never navigates itself, so the suite drives the pathname hook directly.
const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn<() => string | null>(() => "/candidato/dashboard") }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

import { CandidateShell } from "./candidate-shell";
import { CandidateHeader } from "./candidate-header";
import { isActiveCandidateDestination } from "./candidate-sidebar";

// Sources as text for the coupling, palette and layout contracts. The candidate
// theme module is optional: the PeopleFlow violet primary lives in globals.css, so
// the correct state is no candidate-scoped override at all.
const source = (file: string) => {
  const path = join(process.cwd(), "src/components/candidate-dashboard", file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};
const SHELL = source("candidate-shell.tsx"), SIDEBAR = source("candidate-sidebar.tsx");
const HEADER = source("candidate-header.tsx"), THEME = source("candidate-theme.module.css");
const SOURCES = [SHELL, SIDEBAR, HEADER, THEME];
const NAV = [["Dashboard", "/candidato/dashboard"], ["Postulaciones", "/candidato/postulaciones"], ["Perfil", "/candidato/perfil"], ["CVs", "/candidato/cvs"], ["Configuración", "/candidato/configuracion"]] as const;
const GROUPS = [["Mi búsqueda", ["Dashboard", "Postulaciones"]], ["Mi perfil", ["Perfil", "CVs", "Configuración"]]] as const;

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the first.
function stubBrowserApis(innerWidth = 1280) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", innerWidth);
}

const sidebar = () => document.querySelector("[data-slot='sidebar']") as HTMLElement;
const navLinks = () => within(document.querySelector("[data-slot='sidebar-content']") as HTMLElement).getAllByRole("link");
const cookie = (name: string) => document.cookie.split("; ").find((e) => e.startsWith(`${name}=`))?.split("=")[1];
const activeLabels = () => NAV.map(([label]) => label).filter((label) => screen.getByRole("link", { name: label }).hasAttribute("data-active"));
function renderShell(pathname: string | null = "/candidato/dashboard", defaultOpen?: boolean, innerWidth = 1280) {
  pathnameMock.mockReturnValue(pathname);
  stubBrowserApis(innerWidth);
  return render(<CandidateShell defaultOpen={defaultOpen}><CandidateHeader /><p>contenido de la ruta</p></CandidateShell>);
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals();
  localStorage.clear();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

describe("candidate shell frame", () => {
  it("mounts one provider, clips the inset and keeps the native icon-rail geometry", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot='sidebar-inset']")).toHaveLength(1);
    expect(sidebar()).toHaveAttribute("data-variant", "inset");
    expect(screen.getByText("contenido de la ruta")).toBeInTheDocument();
    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']") as HTMLElement;
    const inset = document.querySelector("[data-slot='sidebar-inset']") as HTMLElement;
    expect(wrapper.className).toContain("bg-primary/5");
    expect(inset.className).toContain("overflow-x-clip");
    expect(inset.className).not.toContain("overflow-x-hidden");
    for (const token of ["md:mt-3", "md:mr-3", "md:mb-3", "md:rounded-3xl", "md:ring-1", "md:ring-primary/15", "md:shadow-md"]) {
      expect(inset.className).toContain(token);
    }
    expect(SHELL).toContain('"--sidebar-width": "calc(var(--spacing) * 72)"');
    expect(SHELL).toContain('"--header-height": "calc(var(--spacing) * 12)"');
    expect(cookie("sidebar_state")).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(sidebar()).toHaveAttribute("data-collapsible", "icon");

    // Candidate destinations reuse the employer's shared 40px default geometry:
    // no 48px `size="lg"` rows and no candidate-only icon-rail override.
    const destinations = navLinks();
    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    for (const target of [brand, ...destinations]) {
      expect(target).toHaveAttribute("data-size", "default");
      expect(target.className).toContain("h-10");
      expect(target.className).toContain("group-data-[collapsible=icon]:size-10!");
      expect(target.className).not.toContain("group-data-[collapsible=icon]:size-8!");
      expect(target.className).not.toContain("h-12");
    }
    expect(brand.className).toContain("data-[slot=sidebar-menu-button]:p-1.5!");
    for (const [label] of NAV) expect(screen.getByRole("link", { name: label })).toHaveAccessibleName(label);
    for (const target of destinations) {
      expect(target).toHaveAttribute("data-base-ui-tooltip-trigger");
      expect(target.querySelector("svg")).not.toBeNull();
    }
    expect(SIDEBAR).not.toContain("ICON_RAIL_TARGET");
    expect(SIDEBAR).not.toContain("group-data-[collapsible=icon]:size-10!");
    expect(SIDEBAR).not.toContain('size="lg"');
    expect(cookie("sidebar_state")).toBe("false");
  });

  it("honors a server-derived collapsed preference without touching the cookie", () => {
    renderShell("/candidato/perfil", false);
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(navLinks()).toHaveLength(5);
    expect(cookie("sidebar_state")).toBeUndefined();
  });

  it("opens the mobile offcanvas drawer on the same destinations", async () => {
    const user = userEvent.setup();
    renderShell("/candidato/perfil", undefined, 375);
    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveAccessibleName("Navegación");
    expect(navLinks().map((link) => link.textContent)).toEqual(NAV.map(([label]) => label));
    expect(within(drawer).getByRole("link", { name: "Perfil" })).toHaveAttribute("data-active");
    // The drawer keeps the shared account trigger, not a direct footer link.
    expect(within(drawer).getByRole("button", { name: /Ximena Barrera/ })).toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: /Ximena Barrera/ })).toBeNull();
    expect(cookie("sidebar_state")).toBeUndefined();
  });
});

describe("candidate navigation", () => {
  it("lists the five destinations in order, grouped, as resolved Next links", () => {
    renderShell();
    const groupNodes = Array.from(document.querySelectorAll("[data-slot='sidebar-group']"));
    const groupLabels = Array.from(document.querySelectorAll("[data-slot='sidebar-group-label']")).map((node) => node.textContent?.trim());
    expect(groupLabels).toEqual(GROUPS.map(([label]) => label));
    for (const [label, expected] of GROUPS) {
      const group = groupNodes.find((node) => node.querySelector("[data-slot='sidebar-group-label']")?.textContent?.trim() === label) as HTMLElement;
      expect(within(group).getAllByRole("link").map((link) => link.textContent)).toEqual([...expected]);
    }
    expect(navLinks().map((link) => [link.textContent, link.getAttribute("href")])).toEqual([...NAV]);
    for (const link of navLinks()) expect(link.getAttribute("href")).not.toBe("#");
    expect(SIDEBAR).not.toMatch(/href=["']?#/);
    expect(SIDEBAR).toContain('import Link from "next/link"');
    expect(SIDEBAR).toContain('from "next/navigation"');
  });

  it("activates on the exact route and its descendants only", () => {
    expect(isActiveCandidateDestination("/candidato/perfil", "/candidato/perfil")).toBe(true);
    expect(isActiveCandidateDestination("/candidato/perfil", "/candidato/perfil/editar")).toBe(true);
    expect(isActiveCandidateDestination("/candidato/cvs", "/candidato/cvs/")).toBe(true);
    expect(isActiveCandidateDestination("/candidato/perfil", "/candidato/perfiles")).toBe(false);
    expect(isActiveCandidateDestination("/candidato/perfil", null)).toBe(false);
  });

  it.each([
    ["/candidato/dashboard", "Dashboard"], ["/candidato/postulaciones", "Postulaciones"], ["/candidato/postulaciones/abc-123", "Postulaciones"],
    ["/candidato/perfil", "Perfil"], ["/candidato/cvs", "CVs"], ["/candidato/configuracion/seguridad", "Configuración"],
  ])("activates only %s on the %s destination", (pathname, expected) => {
    renderShell(pathname);
    expect(activeLabels()).toEqual([expected]);
  });

  it.each(["/candidato/mensajes", "/candidato/perfiles", "/candidato/postulaciones-archivadas", "/empresa/dashboard", "/", "", null])("leaves every destination inactive on %s", (pathname) => {
    renderShell(pathname);
    expect(activeLabels()).toEqual([]);
  });
});

describe("candidate identity", () => {
  it("adopts the shared NavUser account composition for the candidate identity", () => {
    renderShell();
    const footer = document.querySelector("[data-slot='sidebar-footer']") as HTMLElement;
    // Shared composition: shadcn Avatar + DropdownMenu trigger, not a plain link
    // and not a hand-rolled initials span.
    expect(within(footer).queryByRole("link", { name: /Ximena Barrera/ })).toBeNull();
    expect(within(footer).getByRole("button", { name: /Ximena Barrera/ })).toBeInTheDocument();
    expect(footer.querySelector("[data-slot='avatar']")).not.toBeNull();
    expect(within(footer).getByText("XB")).toBeInTheDocument();
    expect(within(footer).getByText("Candidata · Espacio personal")).toBeInTheDocument();
    expect(SIDEBAR).toContain('from "@/components/company-dashboard/nav-user"');
    expect(SIDEBAR).toContain("<NavUser");
    expect(SIDEBAR).not.toContain("candidateInitials");
    expect(SIDEBAR).not.toContain("bg-sidebar-primary");
    expect(SIDEBAR).not.toContain('"XB"');
    // Candidate menu entries stay real candidate routes; employer-only actions never leak in.
    for (const employerOnly of ["Cerrar sesión", "Plan y facturación", "Notificaciones", "IconLogout", "IconCreditCard", "IconNotification"]) {
      expect(SIDEBAR, employerOnly).not.toContain(employerOnly);
    }
  });

  it("keeps hiring-side identity, demo copy, fake actions and coupling out", () => {
    renderShell();
    const forbidden = [
      "Nexo Labs", "Tomás Ríos", "Talent Lead", "Acme Inc.", "Camila Núñez", "Nueva vacante", "Cerrar sesión", "Plan y facturación", "Notificaciones", "m@example.com", "EmployerShell", "AppSidebar", "SiteHeader",
      "employer", "empresa", "reclut", "dashboard-01-theme", "IconLogout", "IconCreditCard", "document.cookie", "next/headers", "cookies(", "useRouter", "useSearchParams", "next/dist", "window.location", "fetch(", "onClick",
      "localStorage", "try {", "catch {",
    ];
    for (const value of forbidden) {
      expect(screen.queryByText(value), value).toBeNull();
      for (const file of SOURCES) expect(file, `${value} in the candidate frame`).not.toContain(value);
    }
  });
});

describe("candidate route header", () => {
  it("keeps Dashboard as the default title with one canonical theme control", () => {
    renderShell();
    const header = document.querySelector("header")!;
    const heading = within(header).getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Dashboard");
    expect(heading).not.toHaveAttribute("aria-current");
    expect(within(header).queryByRole("navigation")).toBeNull();
    expect(within(header).getByRole("button", { name: /toggle sidebar/i })).toBeInTheDocument();
    expect(header.querySelector("[data-slot='separator']")).not.toBeNull();
    expect(document.querySelectorAll("[data-pf-theme-toggle]")).toHaveLength(1);
    expect(HEADER).toContain('import { ThemeToggle } from "@/components/theme/theme-toggle"');
    expect(HEADER).not.toMatch(/useState|localStorage|pf-theme/);
  });

  it("renders a linked parent crumb with the current label as the page heading", () => {
    stubBrowserApis();
    render(<CandidateShell><CandidateHeader title="Perfil" parent={{ label: "Mi perfil", href: "/candidato/perfil" }} /></CandidateShell>);
    const header = document.querySelector("header")!;
    const nav = within(header).getByRole("navigation", { name: "Ruta de navegación" });
    expect(within(nav).getByRole("link", { name: "Mi perfil" })).toHaveAttribute("href", "/candidato/perfil");
    const heading = within(header).getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Perfil");
    expect(heading).toHaveAttribute("aria-current", "page");
    expect(nav.contains(heading)).toBe(false);
    expect(HEADER).toContain('import Link from "next/link"');
  });
});

describe("candidate PeopleFlow violet primary", () => {
  it("inherits the global violet primary instead of a candidate-scoped override", () => {
    // globals.css owns the violet preset for `--primary`/`--sidebar-primary`; any
    // candidate-scoped restatement silently repaints the whole profile.
    expect([...THEME.matchAll(/(--[a-z-]+)\s*:/gu)].map(([, token]) => token)).toEqual([]);
    for (const cyan of ["#0e7490", "#22d3ee", "#0c0912"]) expect(THEME.toLowerCase(), cyan).not.toContain(cyan);
    for (const file of SOURCES) expect(file.toLowerCase()).not.toMatch(/#0e7490|#22d3ee|#0c0912/u);
    expect(SHELL).not.toContain("--primary");
    // The frame keeps its tint, which now derives from the peopleflow violet primary.
    expect(SHELL).toContain("bg-primary/5");
  });
});
