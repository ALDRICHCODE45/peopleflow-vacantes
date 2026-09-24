import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/configuracion"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// (none) while still rendering the committed settings surface.
vi.mock("@/features/candidate/settings-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/settings-workspace")>();
  const RealWorkspace = actual.SettingsWorkspace;
  return {
    ...actual,
    SettingsWorkspace: () => {
      workspaceSpy({});
      return <RealWorkspace />;
    },
  };
});

import ConfiguracionPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/configuracion/page.tsx"), "utf8");
const OLD_ROUTE = join(process.cwd(), "src/app/(candidato)/candidato/cuenta/page.tsx");
const OLD_WORKSPACE = join(process.cwd(), "src/features/candidate/account-workspace.tsx");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

function stubBrowserApis() {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><ConfiguracionPage /></CandidateShell>);
const workspace = () => document.querySelector("[data-pf-settings-workspace]") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  workspaceSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/configuracion");
  localStorage.clear();
});

describe("candidate settings route", () => {
  beforeEach(stubBrowserApis);

  it("keeps Configuración metadata and exactly one header title before the single workspace", () => {
    expect(metadata.title).toBe("Configuración");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Configuración$/u);
    const workspaces = document.querySelectorAll("[data-pf-settings-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mounts the settings workspace with no identity fixture at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual([]);
    const text = workspace().textContent ?? "";
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("Ximena");
    expect(text).not.toContain("@");
  });

  it("activates only Configuración inside the shared candidate shell", () => {
    renderRoute();
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual(["Configuración"]);
  });

  it("stays a server-only page with no client, storage, network, form or input behaviour", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["CandidateDestinationShell", "data-pf-destination", "preview", "summary"]) {
      expect(SOURCE, `page must not keep placeholder ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation", "useRouter", "fetch(", "localStorage", "sessionStorage", "document.cookie", "useState", "useEffect", "onClick", "<form", "<input", "<main", "window.", "redirect(", "CANDIDATE_IDENTITY", "prototype-"]) {
      expect(SOURCE, `page must not own ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
    expect(SOURCE).toContain('import { SettingsWorkspace } from "@/features/candidate/settings-workspace"');
    expect(SOURCE).toContain('title="Configuración"');
    expect(SOURCE).toContain("<SettingsWorkspace />");
  });

  it("deletes the old candidate account route and workspace sources", () => {
    expect(existsSync(OLD_ROUTE)).toBe(false);
    expect(existsSync(OLD_WORKSPACE)).toBe(false);
  });
});
