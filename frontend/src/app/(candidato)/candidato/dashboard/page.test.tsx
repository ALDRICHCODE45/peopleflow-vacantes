import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio";

const { pathnameMock, overviewSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/dashboard"),
  overviewSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real overview so the route test observes the exact props at the boundary
// while still rendering the committed metric and link behavior.
vi.mock("@/components/candidate-dashboard/candidate-dashboard-overview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/candidate-dashboard/candidate-dashboard-overview")>();
  const RealOverview = actual.CandidateDashboardOverview;
  return {
    ...actual,
    CandidateDashboardOverview: (props: React.ComponentProps<typeof RealOverview>) => {
      overviewSpy(props);
      return <RealOverview {...props} />;
    },
  };
});

import DashboardPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/dashboard/page.tsx"), "utf8");

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><DashboardPage /></CandidateShell>);
const metric = (label: string) => document.querySelector(`[data-pf-overview-metric="${label}"]`) as HTMLElement;
const recentSection = () => document.querySelector("[data-pf-recent-applications]") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  overviewSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/dashboard");
  localStorage.clear();
});

describe("candidate dashboard route", () => {
  beforeEach(stubBrowserApis);

  it("keeps Dashboard metadata and exactly one H1 through the shared header", () => {
    expect(metadata.title).toBe("Dashboard");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Dashboard$/u);
  });

  it("supplies exactly the four committed frozen fixtures at the page boundary", () => {
    renderRoute();
    const props = overviewSpy.mock.calls[overviewSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["identity", "profile", "applications", "cvs"]);
    expect(props.identity).toBe(CANDIDATE_IDENTITY);
    expect(props.profile).toBe(CANDIDATE_PROFILE);
    expect(props.applications).toBe(CANDIDATE_APPLICATIONS);
    expect(props.cvs).toBe(CANDIDATE_CVS);
    expect(Object.isFrozen(props.applications)).toBe(true);
    expect(Object.isFrozen(props.cvs)).toBe(true);
  });

  it("renders the frozen expected metrics", () => {
    renderRoute();
    expect(metric("Postulaciones")).toHaveTextContent("4 postulaciones registradas");
    expect(metric("En proceso")).toHaveTextContent("2");
    expect(metric("Perfil completo")).toHaveTextContent("100%");
    expect(metric("CVs")).toHaveTextContent("2 CVs disponibles");
  });

  it("shows recent applications with canonical links and an honest historical row", () => {
    renderRoute();
    const recent = recentSection();
    const rows = within(recent).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Desarrolladora Go"),
      expect.stringContaining("Ingeniera Frontend"),
      expect.stringContaining("Analista de Datos"),
    ]);
    expect(within(rows[0]).getByRole("link", { name: /Ver vacante de Desarrolladora Go/u })).toHaveAttribute("href", CANDIDATE_APPLICATIONS[0].publicJobHref);
    expect(within(rows[1]).getByRole("link", { name: /Ver vacante de Ingeniera Frontend/u })).toHaveAttribute("href", CANDIDATE_APPLICATIONS[1].publicJobHref);
    expect(within(rows[2]).queryByRole("link")).toBeNull();
    expect(rows[2]).toHaveTextContent("Vacante histórica sin enlace");
    expect(within(recent).getByRole("link", { name: "Ver todas mis postulaciones" })).toHaveAttribute("href", "/candidato/postulaciones");
  });

  it("keeps the honest local-demo disclosure", () => {
    renderRoute();
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-candidate-overview-disclosure");
    expect(note).toHaveTextContent(/demo local/iu);
    expect(note).toHaveTextContent(/no guarda cambios/u);
  });

  it("activates only Dashboard inside the shared candidate shell", () => {
    pathnameMock.mockReturnValue("/candidato/dashboard");
    renderRoute();
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual(["Dashboard"]);
  });

  it("replaces the placeholder preview and owns no shell, side effect or fixture literal", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["CandidateDestinationShell", "data-pf-destination", "preview", "summary"]) {
      expect(SOURCE, `page must not keep placeholder ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation", "useRouter", "fetch(", "localStorage", "sessionStorage", "document.cookie", "useState", "useEffect", "onClick", "<form", "<input", "<main", "window.", "redirect("]) {
      expect(SOURCE, `page must not own ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
    expect(SOURCE).toContain('import { CandidateDashboardOverview } from "@/components/candidate-dashboard/candidate-dashboard-overview"');
    for (const fixture of ["CANDIDATE_IDENTITY", "CANDIDATE_PROFILE", "CANDIDATE_APPLICATIONS", "CANDIDATE_CVS"]) {
      expect(SOURCE, `page must wire ${fixture}`).toContain(fixture);
    }
    expect(SOURCE).toContain('title="Dashboard"');
  });
});
