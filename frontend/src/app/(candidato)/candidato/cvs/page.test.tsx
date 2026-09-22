import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/cvs"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// while still rendering the committed inventory, facts and disabled actions.
vi.mock("@/features/candidate/cv-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/cv-workspace")>();
  const RealWorkspace = actual.CvWorkspace;
  return {
    ...actual,
    CvWorkspace: (props: React.ComponentProps<typeof RealWorkspace>) => {
      workspaceSpy(props);
      return <RealWorkspace {...props} />;
    },
  };
});

import CvsPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const NOTE_ID = "pf-cv-actions-note";
const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/cvs/page.tsx"), "utf8");
const [PRIMARY, SECONDARY] = CANDIDATE_CVS;

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><CvsPage /></CandidateShell>);
const workspace = () => document.querySelector("[data-pf-cv-workspace]") as HTMLElement;
const cards = () => Array.from(document.querySelectorAll("[data-pf-cv-card]"));
const card = (cv: (typeof CANDIDATE_CVS)[number]) => document.querySelector(`[data-pf-cv-card="${cv.id}"]`) as HTMLElement;
const buttons = () => Array.from(workspace().querySelectorAll("button")) as HTMLButtonElement[];
const facts = (element: HTMLElement) => {
  const terms = Array.from(element.querySelectorAll("dt")).map((dt) => dt.textContent);
  const values = Array.from(element.querySelectorAll("dd")).map((dd) => dd.textContent);
  return terms.map((term, index) => [term, values[index]]);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  workspaceSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/cvs");
  localStorage.clear();
});

describe("candidate CV route", () => {
  beforeEach(stubBrowserApis);

  it("keeps CVs metadata and exactly one H1 before the single workspace", () => {
    expect(metadata.title).toBe("CVs");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^CVs$/u);
    const workspaces = document.querySelectorAll("[data-pf-cv-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supplies exactly the frozen CV inventory at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["cvs"]);
    expect(props.cvs).toBe(CANDIDATE_CVS);
    expect(Object.isFrozen(props.cvs)).toBe(true);
  });

  it("renders the two committed cards with every fact in the frozen order", () => {
    renderRoute();
    expect(cards().map((node) => node.getAttribute("data-pf-cv-card"))).toEqual([PRIMARY.id, SECONDARY.id]);
    expect(facts(card(PRIMARY))).toEqual([
      ["Rol", "Principal"], ["Idioma", "Español"], ["Actualizado", "10 de marzo de 2026"], ["Tamaño", "340 KB"], ["Formato", "PDF"],
    ]);
    expect(facts(card(SECONDARY))).toEqual([
      ["Rol", "Secundario"], ["Idioma", "Inglés"], ["Actualizado", "18 de febrero de 2026"], ["Tamaño", "291 KB"], ["Formato", "PDF"],
    ]);
    expect(card(PRIMARY)).toHaveTextContent(PRIMARY.fileName);
    expect(card(SECONDARY)).toHaveTextContent(SECONDARY.fileName);
  });

  it("renders exactly the disabled inventory actions and the honest local disclosure", () => {
    renderRoute();
    expect(buttons().map((button) => button.textContent)).toEqual([
      "Subir CV (no disponible)",
      "Reemplazar (no disponible)", "Descargar (no disponible)",
      "Reemplazar (no disponible)", "Descargar (no disponible)", "Usar como principal (no disponible)",
    ]);
    for (const button of buttons()) {
      expect([button.getAttribute("type"), button.disabled, button.getAttribute("onclick")]).toEqual(["button", true, null]);
      expect(button).toHaveAttribute("aria-describedby", NOTE_ID);
    }
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-cv-disclosure");
    for (const claim of [
      "metadatos ficticios",
      "no están disponibles para previsualizar ni descargar",
      "no se sube, reemplaza, guarda ni genera nada",
      "el CV principal no puede cambiar",
    ]) expect(note).toHaveTextContent(claim);
    expect(workspace().querySelector(`[data-pf-cv-actions-note]#${NOTE_ID}`)).not.toBeNull();
  });

  it("keeps the workspace free of links, forms, inputs and handlers", () => {
    renderRoute();
    expect(workspace().querySelectorAll("a")).toHaveLength(0);
    expect(workspace().querySelectorAll("form")).toHaveLength(0);
    expect(workspace().querySelectorAll("input")).toHaveLength(0);
    expect(workspace().querySelectorAll("[onclick]")).toHaveLength(0);
  });

  it("activates only CVs inside the shared candidate shell", () => {
    renderRoute();
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual(["CVs"]);
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
    expect(SOURCE).toContain('import { CvWorkspace } from "@/features/candidate/cv-workspace"');
    expect(SOURCE).toContain('import { CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio"');
    expect(SOURCE).toContain('title="CVs"');
    expect(SOURCE).toContain("<CvWorkspace cvs={CANDIDATE_CVS} />");
  });
});
