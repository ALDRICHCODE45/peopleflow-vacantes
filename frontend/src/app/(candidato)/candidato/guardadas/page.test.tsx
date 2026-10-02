import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/guardadas"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// while still rendering the committed card grid, facts and empty state.
vi.mock("@/features/candidate/saved-vacancies-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/saved-vacancies-workspace")>();
  const RealWorkspace = actual.SavedVacanciesWorkspace;
  return {
    ...actual,
    SavedVacanciesWorkspace: (props: React.ComponentProps<typeof RealWorkspace>) => {
      workspaceSpy(props);
      return <RealWorkspace {...props} />;
    },
  };
});

import GuardadasPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const TITLE = "Vacantes guardadas";
const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/guardadas/page.tsx"), "utf8");

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><GuardadasPage /></CandidateShell>);
const cards = () => Array.from(document.querySelectorAll("[data-pf-saved-vacancy]")) as HTMLElement[];
const card = (id: string) => document.querySelector(`[data-pf-saved-vacancy="${id}"]`) as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  workspaceSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/guardadas");
});

describe("candidate saved vacancies route", () => {
  beforeEach(stubBrowserApis);

  it("keeps the saved-vacancies metadata and exactly one H1 before the single workspace", () => {
    expect(metadata.title).toBe(TITLE);
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(new RegExp(`^${TITLE}$`, "u"));
    const workspaces = document.querySelectorAll("[data-pf-saved-vacancies-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supplies exactly the frozen Acme prototype fixtures at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["savedVacancies"]);
    expect(props.savedVacancies).toBe(ACME_PROTOTYPE_JOBS);
    expect(Object.isFrozen(props.savedVacancies)).toBe(true);
    expect((props.savedVacancies as readonly { readonly id: string }[]).map((job) => job.id)).toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.id));
  });

  it("renders the canonical cards with the formatter facts and the one link per vacancy", () => {
    renderRoute();
    expect(cards()).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    for (const job of ACME_PROTOTYPE_JOBS) {
      const node = card(job.id);
      expect(node).toHaveTextContent(job.title);
      expect(node).toHaveTextContent(job.company.name);
      const links = Array.from(node.querySelectorAll("a")) as HTMLElement[];
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", `/vacantes/${job.id}`);
    }
    const frontend = card(ACME_PROTOTYPE_JOBS[0].id);
    expect(frontend).toHaveTextContent("Remoto");
    expect(frontend).toHaveTextContent("Tiempo completo");
    expect(frontend).toHaveTextContent("Senior");
    const go = card(ACME_PROTOTYPE_JOBS[1].id);
    expect(go).toHaveTextContent("Híbrido");
    expect(go).toHaveTextContent("Por contrato");
    expect(go).toHaveTextContent("Líder");
    expect(go).toHaveTextContent("Monterrey, Nuevo León");
    expect(go).toHaveTextContent("MXN 30,000 – MXN 45,000");
    expect(document.querySelector("[data-pf-saved-vacancies-workspace] h2")).toHaveTextContent(TITLE);
  });

  it("renders no implementation-status disclosure, no mutation control and activates only its own destination", () => {
    renderRoute();
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.querySelector("[data-pf-saved-vacancies-disclosure]")).toBeNull();
    expect(document.querySelectorAll("[data-pf-saved-vacancies-workspace] button")).toHaveLength(0);
    expect(document.querySelectorAll("[data-pf-saved-vacancies-workspace] form")).toHaveLength(0);
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = Array.from(nav.querySelectorAll("a[data-active]")).map((link) => link.textContent);
    expect(active).toEqual([TITLE]);
  });

  it("owns no shell, side effect, storage or fixture literal", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["CandidateDestinationShell", "data-pf-destination", "preview", "summary"]) {
      expect(SOURCE, `page must not keep placeholder ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation", "useRouter", "fetch(", "localStorage", "sessionStorage", "document.cookie", "useState", "useEffect", "onClick", "<form", "<input", "<main", "window.", "redirect(", "sort(", "filter("]) {
      expect(SOURCE, `page must not own ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
    expect(SOURCE).toContain('import { SavedVacanciesWorkspace } from "@/features/candidate/saved-vacancies-workspace"');
    expect(SOURCE).toContain('import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs"');
    expect(SOURCE).toContain(`title="${TITLE}"`);
    expect(SOURCE).toContain("<SavedVacanciesWorkspace savedVacancies={ACME_PROTOTYPE_JOBS} />");
  });
});
