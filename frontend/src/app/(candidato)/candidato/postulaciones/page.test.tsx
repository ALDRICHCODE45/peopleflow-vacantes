import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_APPLICATIONS } from "@/features/candidate/prototype-portfolio";
import { APPLICATION_SOURCE_LABELS, APPLICATION_STATUS_LABELS } from "@/features/candidate/portfolio-model";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/postulaciones"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// while still rendering the committed filter, search and row behavior.
vi.mock("@/features/candidate/applications-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/applications-workspace")>();
  const RealWorkspace = actual.ApplicationsWorkspace;
  return {
    ...actual,
    ApplicationsWorkspace: (props: React.ComponentProps<typeof RealWorkspace>) => {
      workspaceSpy(props);
      return <RealWorkspace {...props} />;
    },
  };
});

import PostulacionesPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const SEARCH_LABEL = "Buscar por puesto o empresa";
const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/postulaciones/page.tsx"), "utf8");

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><PostulacionesPage /></CandidateShell>);
const row = (application: (typeof CANDIDATE_APPLICATIONS)[number]) => document.querySelector(`[data-pf-application-row="${application.id}"]`) as HTMLElement;
const rows = () => Array.from(document.querySelectorAll("[data-pf-application-row]"));
const filter = (name: RegExp) => screen.getByRole("button", { name });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  workspaceSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/postulaciones");
});

describe("candidate applications route", () => {
  beforeEach(stubBrowserApis);

  it("keeps Postulaciones metadata and exactly one H1 before the single workspace", () => {
    expect(metadata.title).toBe("Postulaciones");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Postulaciones$/u);
    const workspaces = document.querySelectorAll("[data-pf-applications-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supplies exactly the frozen applications fixture at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["applications"]);
    expect(props.applications).toBe(CANDIDATE_APPLICATIONS);
    expect(Object.isFrozen(props.applications)).toBe(true);
  });

  it("renders the four committed rows with every status fact", () => {
    renderRoute();
    expect(rows()).toHaveLength(4);
    for (const application of CANDIDATE_APPLICATIONS) {
      const item = row(application);
      expect(item).toHaveTextContent(application.jobTitle);
      expect(item).toHaveTextContent(application.companyName);
      expect(item).toHaveTextContent(APPLICATION_STATUS_LABELS[application.status]);
      expect(item).toHaveTextContent(APPLICATION_SOURCE_LABELS[application.source]);
      const times = item.querySelectorAll("time");
      expect(times).toHaveLength(2);
      expect(times[0]).toHaveAttribute("datetime", application.createdAt);
      expect(times[1]).toHaveAttribute("datetime", application.updatedAt);
    }
    const statuses = rows().map((item) => item.querySelector("dl dd")?.textContent);
    expect(statuses).toEqual(CANDIDATE_APPLICATIONS.map((application) => APPLICATION_STATUS_LABELS[application.status]));
  });

  it("filters, searches and recovers the empty state over the shared workspace", async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(filter(/^Enviadas/u));
    expect(rows()).toHaveLength(1);
    expect(filter(/^Enviadas/u)).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText(SEARCH_LABEL), "zzz");
    const empty = document.querySelector("[data-pf-applications-empty]") as HTMLElement;
    expect(empty).toHaveTextContent("Sin resultados");
    expect(rows()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveValue("");
    expect(filter(/^Todas/u)).toHaveAttribute("aria-pressed", "true");
  });

  it("renders two canonical vacancy links and two honest historical rows", () => {
    renderRoute();
    const linked = CANDIDATE_APPLICATIONS.filter((application) => application.publicJobHref !== null);
    const historical = CANDIDATE_APPLICATIONS.filter((application) => application.publicJobHref === null);
    expect(linked).toHaveLength(2);
    expect(historical).toHaveLength(2);
    expect(document.querySelectorAll("[data-pf-applications-workspace] a")).toHaveLength(2);
    for (const application of linked) {
      const links = row(application).querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", application.publicJobHref);
      expect(links[0]).toHaveAttribute("aria-label", `Ver vacante de ${application.jobTitle} en ${application.companyName}`);
    }
    for (const application of historical) {
      const item = row(application);
      expect(item.querySelectorAll("a")).toHaveLength(0);
      expect(item).toHaveTextContent("Vacante histórica sin enlace");
    }
  });

  it("keeps the local read-only disclosure and activates only Postulaciones", () => {
    renderRoute();
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-applications-disclosure");
    expect(note).toHaveTextContent(/solo lectura/u);
    expect(note).toHaveTextContent(/no se guarda nada/u);
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = Array.from(nav.querySelectorAll("a[data-active]")).map((link) => link.textContent);
    expect(active).toEqual(["Postulaciones"]);
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
    expect(SOURCE).toContain('import { ApplicationsWorkspace } from "@/features/candidate/applications-workspace"');
    expect(SOURCE).toContain('import { CANDIDATE_APPLICATIONS } from "@/features/candidate/prototype-portfolio"');
    expect(SOURCE).toContain('title="Postulaciones"');
    expect(SOURCE).toContain("<ApplicationsWorkspace applications={CANDIDATE_APPLICATIONS} />");
  });
});
