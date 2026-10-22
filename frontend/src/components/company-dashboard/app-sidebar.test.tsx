import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Route awareness comes from the App Router pathname hook; the suite drives it
// directly instead of mounting the router. The create action still navigates
// through a native GET form, so no imperative navigation is exercised here.
const { pathnameMock, identityMock, companyMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/empresa/dashboard"),
  identityMock: vi.fn(),
  companyMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: identityMock }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: companyMock }));

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "./ui/sidebar";

const CREATE_VACANCY_ROUTE = "/empresa/vacantes/borradores/nuevo";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/app-sidebar.tsx"),
  "utf8",
);

const PRINCIPAL_ITEMS = [
  "Dashboard",
  "Vacantes",
  "Base de talento",
] as const;
const ORGANIZATION_ITEMS = [
  "Equipo",
  "Sitio de empleo",
  "Configuración",
] as const;

// Every visible navigation destination is backed by a real App Router page.
const RESOLVED_DESTINATIONS = {
  Dashboard: "/empresa/dashboard",
  Vacantes: "/empresa/vacantes",
  "Base de talento": "/empresa/talento",
  Equipo: "/empresa/equipo",
  "Sitio de empleo": "/empresa/sitio",
  "Configuración": "/empresa/configuracion",
} as const;
const REMOVED_ITEMS = ["Mensajes", "Reportes"] as const;
const ALL_ITEMS = Object.keys(RESOLVED_DESTINATIONS);

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the
// first through `useIsMobile`, so it is stubbed to the desktop branch.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1280);
}

function renderSidebar(pathname: string | null = "/empresa/dashboard") {
  pathnameMock.mockReturnValue(pathname);
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

/** The nav label's control, whether it is a resolved link or an inert button. */
function navControl(label: string): HTMLElement {
  return (
    screen.queryByRole("link", { name: label }) ??
    screen.getByRole("button", { name: label })
  );
}

/** The nav labels currently carrying the active state. */
function activeLabels(): string[] {
  return ALL_ITEMS.filter((label) =>
    navControl(label).hasAttribute("data-active"),
  );
}

/** Returns the `[data-slot="sidebar-group"]` element carrying `label`. */
function groupLabeled(label: string): HTMLElement {
  const labels = Array.from(
    document.querySelectorAll("[data-slot='sidebar-group-label']"),
  );
  const match = labels.find((node) => node.textContent?.trim() === label);
  expect(match, `${label} group label`).toBeDefined();
  return match!.closest("[data-slot='sidebar-group']") as HTMLElement;
}

/**
 * Recruiting destinations of `group` in render order. Resolved items are links
 * and unresolved items are inert buttons, so the order check reads both roles
 * and skips the native create action that lives inside the same group.
 */
function groupDestinations(label: string): string[] {
  return Array.from(
    groupLabeled(label).querySelectorAll("[data-slot='sidebar-menu-button']"),
  )
    .filter((node) => node.closest("form") === null)
    .map((node) => node.textContent?.trim() ?? "");
}

const realIdentity = {
  status: "ready",
  result: { ok: true, data: { role: "recruiter", user: { id: "user-1", full_name: "Ana Pérez", email: "ana@empresa.mx" } } },
};
const realCompany = {
  kind: "exists", role: "owner", industryLabel: "Tecnología",
  company: { id: "company-1", name: "Empresa Real", rfc: "ABC123456789", industry_id: "i", status: "active", location: null, updated_at: "2026-10-20T12:00:00Z" },
};
beforeEach(() => {
  identityMock.mockReturnValue(realIdentity);
  companyMock.mockReset().mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard sidebar identity", () => {
  beforeEach(stubBrowserApis);

  it("replaces the stock company glyph and name with the PeopleFlow wordmark", () => {
    renderSidebar();

    expect(screen.queryByText("Acme Inc.")).toBeNull();
    expect(document.querySelector("svg.tabler-icon-inner-shadow-top")).toBeNull();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    expect(brand).toHaveAttribute("href", "/empresa/dashboard");

    const marks = Array.from(brand.querySelectorAll("[data-brand='wordmark'] img"));
    expect(marks.map((img) => img.getAttribute("src"))).toEqual([
      expect.stringContaining("peopleflow-light"),
      expect.stringContaining("peopleflow-dark"),
    ]);
    // One mark per color scheme: the sidebar must stay correct in both themes
    // through the canonical brand classes, not through a hard-coded variant.
    expect(marks[0].className).toContain("brand-mark-light");
    expect(marks[1].className).toContain("brand-mark-dark");
  });

  it("fits the wordmark into the approved sidebar header geometry", () => {
    renderSidebar();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });

    // The wordmark is 24px tall inside the shared 40px row with the approved
    // 6px padding override (28px of room), slightly larger than the old 20px glyph.

    expect(brand.className).toContain("h-10");
    expect(brand.className).toContain("data-[slot=sidebar-menu-button]:p-1.5!");

    for (const mark of Array.from(brand.querySelectorAll("[data-brand='wordmark'] img"))) {
      expect(mark.className).toContain("h-6");
      expect(mark.className).toContain("w-auto");
      expect(mark.className).not.toContain("h-8");
    }
  });

  it("keeps every sidebar row on the shared 40px hit target", () => {
    renderSidebar();

    const rows = Array.from(
      document.querySelectorAll("[data-slot='sidebar-menu-button']"),
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // Shared 40px targets fit inside the rail with equal horizontal insets.
      expect(row.className).toContain("h-10");
      expect(row.className).toContain("group-data-[collapsible=icon]:size-10!");
      expect(row.className).toContain("group-data-[collapsible=icon]:mx-auto");
      expect(row.className).toContain("group-data-[collapsible=icon]:justify-center");
      expect(row.className).not.toContain("h-8");
      expect(row.className).not.toContain("group-data-[collapsible=icon]:size-8!");
    }
  });

  it("introduces no raw color value", () => {
    expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
  });
});

describe("company dashboard sidebar navigation", () => {
  beforeEach(stubBrowserApis);

  it("labels the two recruiting groups", () => {
    renderSidebar();

    const labels = Array.from(
      document.querySelectorAll("[data-slot='sidebar-group-label']"),
    ).map((node) => node.textContent?.trim());

    expect(labels).toEqual(["Principal", "Organización"]);
  });

  it("lists the primary recruiting destinations in order", () => {
    renderSidebar();

    // Recruiting destinations keep their shared order, with no dead entry.
    expect(groupDestinations("Principal")).toEqual([...PRINCIPAL_ITEMS]);
  });

  it("lists the organization destinations in order", () => {
    renderSidebar();

    // Organization destinations, including settings, are all real links.
    expect(groupDestinations("Organización")).toEqual([...ORGANIZATION_ITEMS]);
  });

  it("renders the careers-site destination as a link with its contextual Tabler icon", () => {
    renderSidebar();

    const link = screen.getByRole("link", { name: "Sitio de empleo" });
    expect(link).toHaveAttribute("href", "/empresa/sitio");
    // One icon library per surface: the destinations keep Tabler marks.
    expect(link.querySelector("svg.tabler-icon")).not.toBeNull();
    expect(link.querySelector("svg.tabler-icon-world")).not.toBeNull();
    expect(link.querySelector("svg.lucide")).toBeNull();
  });

  it("binds every destination to an existing page and removes unresolved entries", () => {
    renderSidebar();

    for (const [label, href] of Object.entries(RESOLVED_DESTINATIONS)) {
      expect(
        screen.getByRole("link", { name: label }),
        `${label} destination`,
      ).toHaveAttribute("href", href);
      expect(existsSync(join(process.cwd(), "src/app/(empresa)", href.slice(1), "page.tsx")), href).toBe(true);
    }
    for (const label of REMOVED_ITEMS) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it.each([
    ["/empresa/dashboard", "Dashboard"],
    ["/empresa/vacantes", "Vacantes"],
    // Nested vacancy routes keep their section active.
    ["/empresa/vacantes/nueva", "Vacantes"],
    ["/empresa/vacantes/borradores/nuevo", "Vacantes"],
    ["/empresa/vacantes/abc-123/pipeline", "Vacantes"],
    ["/empresa/vacantes/", "Vacantes"],
    ["/empresa/equipo", "Equipo"],
    ["/empresa/equipo/maria-lopez", "Equipo"],
    ["/empresa/talento", "Base de talento"],
    ["/empresa/sitio", "Sitio de empleo"],
    ["/empresa/sitio/identidad", "Sitio de empleo"],
    ["/empresa/configuracion", "Configuración"],
  ])("activates only %s on the %s section", (pathname, expected) => {
    renderSidebar(pathname);

    expect(activeLabels()).toEqual([expected]);
  });

  it("does not activate a section for a sibling route that shares its prefix", () => {
    // None of these is a child of its similarly named section route.
    for (const pathname of [
      "/empresa/vacantes-archivadas",
      "/empresa/sitio-archivado",
      "/empresa/equipo-externo",
    ]) {
      renderSidebar(pathname);

      expect(activeLabels(), `${pathname} sibling`).toEqual([]);
      cleanup();
    }
  });

  it("activates nothing on an unmatched employer route", () => {
    renderSidebar("/empresa/reportes");

    expect(activeLabels()).toEqual([]);
  });

  it("never activates a destination for an empty or unrelated pathname", () => {
    for (const pathname of ["#", "", "/", null]) {
      renderSidebar(pathname);
      expect(activeLabels()).toEqual([]);
      cleanup();
    }
  });

  it("renames the quick-create action to the recruiting call to action", () => {
    renderSidebar();

    const cta = screen.getByRole("button", { name: "Nueva vacante" });
    expect(cta.className).toContain("bg-primary");
    expect(cta.className).toContain("text-primary-foreground");
    expect(cta.className).toContain("min-w-8");

    expect(screen.queryByText("Quick Create")).toBeNull();
    expect(screen.queryByRole("button", { name: /inbox/i })).toBeNull();
  });

  it("drops the stock demo navigation definitions", () => {
    renderSidebar();

    for (const stock of [
      "Lifecycle",
      "Analytics",
      "Projects",
      "Team",
      "Documents",
      "Data Library",
      "Reports",
      "Word Assistant",
      "Settings",
      "Get Help",
      "Search",
      "Active Proposals",
      "Archived",
    ]) {
      expect(screen.queryByText(stock), `${stock} stock entry`).toBeNull();
    }

    for (const dead of [
      "navClouds",
      "Active Proposals",
      "Word Assistant",
      "Data Library",
      "IconCamera",
      "IconFileAi",
      "IconFileWord",
      "IconDatabase",
    ]) {
      expect(source, `${dead} dead definition`).not.toContain(dead);
    }
  });
});

describe("company dashboard sidebar create action", () => {
  beforeEach(stubBrowserApis);

  it("keeps the create action on native button semantics instead of a link", () => {
    renderSidebar();

    const cta = screen.getByRole("button", { name: "Nueva vacante" });

    expect(cta.tagName).toBe("BUTTON");
    // `SidebarMenuButton` defaults to a button and declares no type, so the
    // submit role has to be explicit for the surrounding form to be used.
    expect(cta).toHaveAttribute("type", "submit");
    expect(cta.closest("a")).toBeNull();
    expect(cta).not.toHaveAttribute("href");
    expect(screen.queryByRole("link", { name: "Nueva vacante" })).toBeNull();
  });

  it("opens the canonical draft editor through a native GET form", () => {
    renderSidebar();

    const cta = screen.getByRole("button", { name: "Nueva vacante" });
    const form = cta.closest("form");

    expect(form, "surrounding create-vacancy form").not.toBeNull();
    expect(form!.getAttribute("action")).toBe(CREATE_VACANCY_ROUTE);
    expect(form!.getAttribute("method")).toBe("get");
    // Native submission: the action is a real destination, so the control keeps
    // working without the client runtime.
    expect(form!.querySelector("a")).toBeNull();
  });

  it("declares no router, click handler or document navigation", () => {
    // Progressive enhancement only: route awareness is limited to the App Router
    // pathname hook; no imperative navigation, click handling, render-time
    // exception control flow or private Next context may appear.
    for (const forbidden of [
      "useRouter",
      "useSearchParams",
      "next/dist",
      "onClick",
      "window.location",
      "try {",
      "catch {",
    ]) {
      expect(
        source,
        `app-sidebar.tsx must not declare ${forbidden}`,
      ).not.toContain(forbidden);
    }

    // The destination is bound declaratively to the form action.
    expect(source).toContain(`action="${CREATE_VACANCY_ROUTE}"`);
    // The only App Router hook the sidebar owns is the pathname.
    expect(source).toContain('from "next/navigation"');
    expect(source).toContain("usePathname");
  });

  it("resolves real destinations through Next links", () => {
    renderSidebar("/empresa/vacantes");

    // The router-backed destinations use `next/link`, so client navigation and
    // prefetching stay with the framework instead of raw anchors.
    expect(source).toContain('import Link from "next/link"');
    expect(screen.getByRole("link", { name: "Vacantes" }).tagName).toBe("A");
  });

  it("keeps only real links alongside the native creation form", () => {
    renderSidebar();
    expect(document.querySelectorAll("[data-slot='sidebar-content'] a")).toHaveLength(6);
    expect(document.querySelectorAll("[data-slot='sidebar-content'] button")).toHaveLength(1);
    expect(document.querySelectorAll("a[href='#']")).toHaveLength(0);

    // The create form is the only form in the shell, and it wraps only the
    // create action.
    const forms = document.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(forms[0].textContent).toContain("Nueva vacante");
  });

  it("supplies useful account destinations instead of the generic placeholder menu", () => {
    // Base UI menu positioning cannot settle in jsdom (see nav-user.test).
    // Browser coverage exercises the actual portal and keyboard navigation.
    expect(source).toContain("menuItems={ACCOUNT_MENU}");
    for (const [label, href] of [["Configuración", "/empresa/configuracion"], ["Equipo", "/empresa/equipo"], ["Sitio de empleo", "/empresa/sitio"]]) {
      expect(source).toContain(`title: "${label}", href: "${href}"`);
    }
  });
});

describe("company dashboard sidebar account identity", () => {
  beforeEach(stubBrowserApis);

  it("renders the signed-in name, email, initials and real company, never the prototype account", async () => {
    companyMock.mockResolvedValue(realCompany);
    renderSidebar();

    const trigger = screen.getByRole("button", { name: /Ana Pérez/ });
    expect(trigger).toHaveTextContent("ana@empresa.mx");
    expect(await screen.findByText("Empresa Real")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Empresa Real");
    expect(screen.getByText("AP")).toHaveAttribute("data-slot", "avatar-fallback");
    expect(document.body).not.toHaveTextContent(/Tomás Ríos|tomas\.rios|Talent Lead|Nexo Labs/);
    expect(companyMock).toHaveBeenCalledTimes(1);
  });

  it("uses the candidate account's neutral treatment while identity is loading", () => {
    identityMock.mockReturnValue({ status: "loading" });
    renderSidebar();
    expect(screen.getByRole("button", { name: /Mi cuenta/ })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Ana Pérez|ana@empresa.mx|Tomás|Nexo Labs|Talent Lead/);
    expect(companyMock).not.toHaveBeenCalled();
  });

  it("stays neutral when an identity result has no user", () => {
    identityMock.mockReturnValue({ status: "ready", result: { ok: true, data: { role: "recruiter" } } });
    renderSidebar();
    expect(screen.getByRole("button", { name: /Mi cuenta/ })).toBeInTheDocument();
    expect(companyMock).not.toHaveBeenCalled();
  });

  it("shows real identity without a company line while membership is loading", () => {
    companyMock.mockReturnValue(new Promise(() => {}));
    renderSidebar();
    expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent("ana@empresa.mx");
    expect(document.body).not.toHaveTextContent(/Empresa Real|Nexo Labs|Talent Lead/);
  });

  it("omits the company line for a non-member", async () => {
    companyMock.mockResolvedValue({ kind: "none", industries: [] });
    await act(async () => { renderSidebar(); });
    const trigger = screen.getByRole("button", { name: /Ana Pérez/ });
    expect(trigger).toHaveTextContent("ana@empresa.mx");
    expect(trigger.querySelectorAll(".grid > span")).toHaveLength(2);
    expect(document.body).not.toHaveTextContent(/Empresa Real|Nexo Labs|Talent Lead| · /);
  });

  it.each(["none", "unauthenticated", "server_error", "no_response", "unrecognized_response"])("keeps identity without inventing a company on %s", async kind => {
    companyMock.mockResolvedValue({ kind, reference: {} });
    await act(async () => { renderSidebar(); });
    expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent("ana@empresa.mx");
    expect(document.body).not.toHaveTextContent(/Empresa Real|Nexo Labs|Talent Lead/);
  });

  it("keeps identity and omits company when the company request rejects", async () => {
    companyMock.mockRejectedValue(new Error("private upstream detail"));
    await act(async () => { renderSidebar(); });
    expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent("ana@empresa.mx");
    expect(document.body).not.toHaveTextContent(/Empresa Real|Nexo Labs|private upstream detail/);
  });

  it("shows a signed-in candidate's identity without company lookup or employer navigation", () => {
    identityMock.mockReturnValue({ ...realIdentity, result: { ok: true, data: { ...realIdentity.result.data, role: "candidate" } } });
    renderSidebar();
    expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent("ana@empresa.mx");
    expect(screen.queryByRole("link", { name: "Vacantes" })).toBeNull();
    expect(companyMock).not.toHaveBeenCalled();
  });

  it("discards a previous account's company and ignores its late response after switching accounts", async () => {
    let resolvePrevious!: (state: typeof realCompany) => void;
    companyMock.mockReturnValueOnce(new Promise(resolve => { resolvePrevious = resolve; }));
    const view = renderSidebar();
    identityMock.mockReturnValue({ ...realIdentity, result: { ok: true, data: { ...realIdentity.result.data, user: { id: "user-2", full_name: "Luz Díaz", email: "luz@otra.mx" } } } });
    companyMock.mockResolvedValue({ kind: "none", industries: [] });
    await act(async () => { view.rerender(<SidebarProvider><AppSidebar /></SidebarProvider>); });
    await act(async () => { resolvePrevious(realCompany); });
    expect(screen.getByRole("button", { name: /Luz Díaz/ })).toHaveTextContent("luz@otra.mx");
    expect(document.body).not.toHaveTextContent(/Ana Pérez|Empresa Real/);
    expect(companyMock).toHaveBeenCalledTimes(2);
  });

  it("clears membership through sign-out even when the same account signs back in", async () => {
    companyMock.mockResolvedValueOnce(realCompany);
    const view = renderSidebar();
    expect(await screen.findByText("Empresa Real")).toBeInTheDocument();
    identityMock.mockReturnValue({ status: "unauthenticated" });
    view.rerender(<SidebarProvider><AppSidebar /></SidebarProvider>);
    expect(screen.getByRole("button", { name: /Mi cuenta/ })).toBeInTheDocument();
    expect(screen.queryByText("Empresa Real")).toBeNull();
    identityMock.mockReturnValue(realIdentity);
    view.rerender(<SidebarProvider><AppSidebar /></SidebarProvider>);
    expect(screen.getByRole("button", { name: /Ana Pérez/ })).toHaveTextContent("ana@empresa.mx");
    expect(screen.queryByText("Empresa Real")).toBeNull();
  });

  it("never embeds prototype account data in the sidebar", () => {
    expect(source).not.toMatch(/Tomás Ríos|tomas\.rios|Talent Lead|Nexo Labs/);
  });

  it("carries no stock avatar in the account data source", () => {
    // PDC-03: identity renders from initials only, so neither the field nor the
    // asset path may survive in the sidebar data.
    expect(source).not.toContain("/avatars");
    expect(source).not.toMatch(/\bavatar\b/i);
  });

  it("renders the initials fallback instead of an avatar image", () => {
    renderSidebar();

    expect(document.querySelectorAll("[data-slot='avatar-image']")).toHaveLength(0);
    // The only images left in the sidebar are the PeopleFlow wordmark marks.
    expect(
      document.querySelectorAll("img[src*='avatars']"),
    ).toHaveLength(0);

    const fallback = screen.getByText("AP");
    expect(fallback).toHaveAttribute("data-slot", "avatar-fallback");
    expect(fallback.className).toContain("bg-primary");
    expect(fallback.className).toContain("text-primary-foreground");
  });

  it("keeps the employer identity out of the PeopleFlow product brand slot", () => {
    renderSidebar();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    expect(brand.textContent).not.toMatch(/Nexo|Tomás|Talent/);
  });
});
