import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The shell never navigates itself, so the suite drives the pathname hook directly.
const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn<() => string | null>(() => "/candidato/dashboard") }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

import { CandidateShell } from "./candidate-shell";
import { CandidateHeader } from "./candidate-header";
import { isActiveCandidateDestination } from "./candidate-sidebar";

// Sources as text for the coupling, palette and layout contracts.
const source = (file: string) => readFileSync(join(process.cwd(), "src/components/candidate-dashboard", file), "utf8");
const SHELL = source("candidate-shell.tsx"), SIDEBAR = source("candidate-sidebar.tsx");
const HEADER = source("candidate-header.tsx"), THEME = source("candidate-theme.module.css");
const SOURCES = [SHELL, SIDEBAR, HEADER, THEME];
const NAV = [["Dashboard", "/candidato/dashboard"], ["Postulaciones", "/candidato/postulaciones"], ["Perfil", "/candidato/perfil"], ["CVs", "/candidato/cvs"], ["Cuenta", "/candidato/cuenta"]] as const;
const GROUPS = [["Mi búsqueda", ["Dashboard", "Postulaciones"]], ["Mi perfil", ["Perfil", "CVs", "Cuenta"]]] as const;

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
  it("mounts one provider, clips the inset and keeps 48px expanded rows with a 40px icon-rail floor", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot='sidebar-inset']")).toHaveLength(1);
    expect(sidebar()).toHaveAttribute("data-variant", "inset");
    expect(screen.getByText("contenido de la ruta")).toBeInTheDocument();
    const inset = document.querySelector("[data-slot='sidebar-inset']") as HTMLElement;
    expect(inset.className).toContain("overflow-x-clip");
    expect(inset.className).not.toContain("overflow-x-hidden");
    expect(SHELL).toContain('"--sidebar-width": "calc(var(--spacing) * 72)"');
    expect(SHELL).toContain('"--header-height": "calc(var(--spacing) * 12)"');
    expect(cookie("sidebar_state")).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(sidebar()).toHaveAttribute("data-collapsible", "icon");
    const link = screen.getByRole("link", { name: "Postulaciones" });
    // jsdom performs no layout: the `size="lg"` 48px row and the 40px collapsed floor are class contracts.
    expect(link.className).toContain("h-12");
    expect(link.className).toContain("group-data-[collapsible=icon]:size-10!");
    expect(link.className).not.toContain("group-data-[collapsible=icon]:size-8!");
    expect(link).toHaveAccessibleName("Postulaciones");
    expect(link).toHaveAttribute("data-base-ui-tooltip-trigger");
    // The brand floors at 40px in both modes; the five destinations and account link share the 40px rail.
    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    const account = within(document.querySelector("[data-slot='sidebar-footer']") as HTMLElement).getByRole("link", { name: /Ximena Barrera/ });
    expect([...navLinks(), account]).toHaveLength(6);
    for (const target of [brand, ...navLinks(), account]) {
      expect(target.className).toContain("group-data-[collapsible=icon]:size-10!");
      expect(target.className).not.toContain("group-data-[collapsible=icon]:size-8!");
    }
    for (const target of [...navLinks(), account]) expect(target.className).toContain("h-12");
    expect(brand.className).toContain("h-10");
    expect(brand.className).toContain("data-[slot=sidebar-menu-button]:p-1.5!");
    expect(SIDEBAR).toContain("group-data-[collapsible=icon]:size-10!");
    expect(SIDEBAR).not.toContain("group-data-[collapsible=icon]:size-8!");
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
    expect(within(drawer).getByRole("link", { name: /Ximena Barrera/ })).toHaveAttribute("href", "/candidato/cuenta");
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
    ["/candidato/perfil", "Perfil"], ["/candidato/cvs", "CVs"], ["/candidato/cuenta/seguridad", "Cuenta"],
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
  it("links the fictional candidate identity straight to the account route", () => {
    renderShell();
    const footer = document.querySelector("[data-slot='sidebar-footer']") as HTMLElement;
    // One plain link: no dropdown, menu, session or credential affordance.
    expect(within(footer).queryAllByRole("button")).toHaveLength(0);
    expect(footer.querySelector("[data-slot='dropdown-menu-trigger']")).toBeNull();
    const account = within(footer).getByRole("link", { name: /Ximena Barrera/ });
    expect(account.tagName).toBe("A");
    expect(account).toHaveAttribute("href", "/candidato/cuenta");
    expect(within(footer).getByText("XB")).toBeInTheDocument();
    expect(within(footer).getByText("Candidata · ximena.barrera@correo.mx")).toBeInTheDocument();
    expect(SIDEBAR).toContain("candidateInitials(CANDIDATE_IDENTITY.fullName)");
    expect(SIDEBAR).not.toContain('"XB"');
  });

  it("keeps hiring-side identity, demo copy, fake actions and coupling out", () => {
    renderShell();
    const forbidden = [
      "Nexo Labs", "Tomás Ríos", "Talent Lead", "Acme Inc.", "Camila Núñez", "Nueva vacante", "Cerrar sesión", "Plan y facturación", "Notificaciones", "m@example.com", "EmployerShell", "AppSidebar", "SiteHeader", "NavUser",
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

describe("candidate cyan theme", () => {
  it("scopes the approved cyan accent to the primary and ring roles only", () => {
    expect(THEME).toContain("#0e7490");
    expect(THEME).toContain("#22d3ee");
    const declared = [...THEME.matchAll(/(--[a-z-]+)\s*:/g)].map(([, token]) => token);
    expect([...new Set(declared)].sort()).toEqual(["--primary", "--primary-foreground", "--ring", "--sidebar-primary", "--sidebar-primary-foreground"]);
    for (const untouched of ["--background", "--card", "--sidebar:", "--radius", "--font-sans", "--accent"]) {
      expect(THEME, `${untouched} must stay global`).not.toContain(untouched);
    }
    const dark = THEME.slice(THEME.indexOf(":global(.dark)"));
    expect(dark).toContain("#22d3ee");
    expect(dark).toContain("#0c0912");
    expect(SHELL).toContain('import candidateTheme from "./candidate-theme.module.css"');
    expect(SHELL).toContain("candidateTheme.root");
  });
});
