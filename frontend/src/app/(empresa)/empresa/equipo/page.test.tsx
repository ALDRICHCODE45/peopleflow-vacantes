import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Route awareness comes from the App Router pathname hook; the suite drives it
// directly so the sidebar marks `Equipo` active without mounting the router.
const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/empresa/equipo"),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

import { EmployerShell } from "@/components/company-dashboard/employer-shell";
import { summarizeTeam } from "@/features/employer-team/model";
import { NEXO_TEAM_MEMBERS } from "@/features/employer-team/prototype-team";

import PageContent, { metadata } from "./page";

// Mirrors the (empresa) layout: the shell wraps the route content.
function Page() {
  return (
    <EmployerShell>
      <PageContent />
    </EmployerShell>
  );
}

const pagePath = join(process.cwd(), "src/app/(empresa)/empresa/equipo/page.tsx");
const pageSource = existsSync(pagePath)
  ? readFileSync(pagePath, "utf8")
  : "";

// jsdom implements neither matchMedia nor ResizeObserver. The sidebar reads the
// first through `useIsMobile` (and the route header mounts the theme control,
// which reads the same media query), so both browser APIs are stubbed to the
// desktop branch.
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
      dispatchEvent: () => false,
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/empresa/equipo employer route", () => {
  beforeEach(stubBrowserApis);

  it("declares its own truthful Spanish route metadata", () => {
    expect(metadata.title).toBe("Equipo");
  });

  it("reuses the shared employer shell without duplicating it", () => {
    render(<Page />);

    // The (empresa) layout owns the single frame: the route must not mount a
    // second sidebar provider, wrapper or brand navigation.
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper!.getAttribute("style")).toContain("--sidebar-width");
    expect(wrapper!.getAttribute("style")).toContain("--header-height");

    // The committed recruiting navigation still reaches the section route.
    expect(screen.getByRole("link", { name: "Equipo" })).toHaveAttribute(
      "href",
      "/empresa/equipo",
    );
    // Equipo must be the only section marked active on its own route.
    expect(
      screen.getByRole("link", { name: "Equipo" }),
    ).toHaveAttribute("data-active");
  });

  it("renders the shared header with the route title and shell controls", () => {
    render(<Page />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(within(header!).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Equipo",
    );
    expect(
      within(header!).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(header!).getByRole("button", { name: "Cambiar tema" }),
    ).toBeInTheDocument();
    // The Equipo header owns no breadcrumb parent and no status slot.
    expect(header!.querySelector("[aria-label='Ruta de navegación']")).toBeNull();
  });

  it("introduces the team section with the agreed Spanish copy", () => {
    render(<Page />);

    expect(
      screen.getByText(
        "Consulta las personas, roles y carga de trabajo de tu equipo de reclutamiento.",
      ),
    ).toBeInTheDocument();
  });

  it("renders no route-level local-demo disclosure or implementation-status copy", () => {
    render(<Page />);

    // The route-level disclosure block is gone and its copy is not re-added
    // anywhere on the route, including the mounted invitation.
    expect(document.querySelector("[data-pf-equipo-disclosure]")).toBeNull();
    expect(screen.queryByText(/datos de demostración locales/i)).toBeNull();
    expect(screen.queryByText(/no se guardan/i)).toBeNull();
  });

  it("mounts exactly one invitation affordance with no disclosure note or outcome surface", () => {
    render(<Page />);

    // One invitation root and one closed toggle by default; the affordance
    // states no implementation-status note or outcome surface in any state.
    expect(document.querySelectorAll("[data-pf-team-invitation]")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Invitar miembro" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "team-invitation-panel");
    const invitation = document.querySelector(
      "[data-pf-team-invitation]",
    ) as HTMLElement;
    // The removed note and outcome hooks must not return, and no
    // implementation-status copy may render inside the invitation root.
    expect(
      invitation.querySelector("[data-pf-team-invitation-note]"),
    ).toBeNull();
    expect(
      invitation.querySelector("[data-pf-team-invitation-status]"),
    ).toBeNull();
    expect(invitation.querySelector("[role='note']")).toBeNull();
    expect(invitation.querySelector("[role='status']")).toBeNull();
    expect(invitation.textContent).not.toMatch(
      /no envía correos ni guarda cambios|no se envió la invitación|prototipo|demostración/iu,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    // The invitation panel stays collapsed until the toggle opens it.
    expect(document.querySelector("[data-pf-team-invitation-panel]")).toBeNull();
  });

  it("opens one clean invitation panel after the toggle is clicked", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<Page />);
    const toggle = screen.getByRole("button", { name: "Invitar miembro" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      document.querySelectorAll("[data-pf-team-invitation-panel]"),
    ).toHaveLength(1);
  });

  it("mounts exactly one workspace with every fixture row in fixture order", () => {
    render(<Page />);

    expect(document.querySelectorAll("[data-pf-team-workspace]")).toHaveLength(1);
    const rows = Array.from(
      document.querySelectorAll("[data-pf-team-row]"),
    ).map((row) => row.getAttribute("data-pf-team-row"));
    expect(rows).toEqual(NEXO_TEAM_MEMBERS.map((member) => member.id));
  });

  it("renders the four derived metrics over the exact six fixture members", () => {
    render(<Page />);

    const metrics = document.querySelectorAll("[data-pf-team-metric]");
    expect(metrics).toHaveLength(4);
    const summary = summarizeTeam(NEXO_TEAM_MEMBERS);
    expect(
      ["total", "owners", "recruiters", "invited"].map(
        (key) =>
          document.querySelector(`[data-pf-team-metric="${key}"]`)?.textContent,
      ),
    ).toEqual([
      `${summary.total}Miembros`,
      `${summary.owners}Propietario`,
      `${summary.recruiters}Reclutadores`,
      `${summary.invited}Invitación pendiente`,
    ]);
  });

  it("bounds the invitation and workspace inside the employer content container", () => {
    const { container } = render(<Page />);

    const content = container.querySelector("[data-pf-equipo-content]");
    expect(content).not.toBeNull();
    expect(content!.className).toContain("px-4");
    expect(content!.className).toContain("py-4");
    expect(content!.className).toContain("md:py-6");
    expect(content!.className).toContain("lg:px-6");
    // The route mounts the shared page-content wrapper as its single padding owner
    // and binds it to the candidate canonical measure.
    expect(content!.hasAttribute("data-pf-page-content")).toBe(true);
    for (const token of ["mx-auto", "w-full", "max-w-screen-2xl"]) {
      expect(content!.className).toContain(token);
    }
    expect(
      content!.contains(document.querySelector("[data-pf-team-invitation]")),
    ).toBe(true);
    expect(
      content!.contains(document.querySelector("[data-pf-team-workspace]")),
    ).toBe(true);
  });
});

describe("/empresa/equipo composition boundary", () => {
  it("mounts the shared header, the invitation affordance and the team workspace", () => {
    expect(pageSource).toContain('<SiteHeader title="Equipo" />');
    expect(pageSource).toContain("<TeamInvitation />");
    expect(pageSource).toContain("<TeamWorkspace members={NEXO_TEAM_MEMBERS} />");
  });

  it("stays a server component", () => {
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).not.toContain("use client");
  });

  it("declares no request, credential or client-state concern", () => {
    // The route is a composition surface: no data access, no client state, no
    // authentication and no transport call may appear here.
    for (const forbidden of [
      "fetch(",
      "lib/api",
      "QueryClient",
      "useRouter",
      "useState",
      "useEffect",
      "Authorization",
      "Bearer",
      "localStorage",
      "sessionStorage",
      "cookies",
      "features/jobs",
    ]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(pageSource).not.toMatch(/session|token|company_membership/i);
  });

  it("never imports or mounts a second employer shell", () => {
    // The shared (empresa) layout owns the frame; the route may mention it in
    // prose, but it must not import or render it.
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
    expect(pageSource).not.toContain("company-dashboard/employer-shell");
    expect(pageSource).not.toContain("company-dashboard/ui/sidebar");
  });

  it("does not declare its own theme module or dashboard palette", () => {
    expect(pageSource).not.toContain("dashboard-01-theme.module.css");
    expect(pageSource).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("reuses the agreed feature entry points and exposes no client conversion", () => {
    for (const reuse of [
      'from "@/components/company-dashboard/site-header"',
      'from "@/features/employer-team/team-invitation"',
      'from "@/features/employer-team/team-workspace"',
      'from "@/features/employer-team/prototype-team"',
    ]) {
      expect(pageSource, `page.tsx must reuse ${reuse}`).toContain(reuse);
    }
  });
});
