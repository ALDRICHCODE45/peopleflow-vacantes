import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_IDENTITY } from "@/features/candidate/prototype-candidate";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/cuenta"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// while still rendering the committed identity, access facts and disabled actions.
vi.mock("@/features/candidate/account-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/account-workspace")>();
  const RealWorkspace = actual.AccountWorkspace;
  return {
    ...actual,
    AccountWorkspace: (props: React.ComponentProps<typeof RealWorkspace>) => {
      workspaceSpy(props);
      return <RealWorkspace {...props} />;
    },
  };
});

import CuentaPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const NOTE_ID = "pf-account-actions-note";
const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/cuenta/page.tsx"), "utf8");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const ACTION_LABELS = ["Cambiar correo (no disponible)", "Cambiar contraseña (no disponible)", "Cerrar sesión (no disponible)"];

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

const renderRoute = () => render(<CandidateShell><CuentaPage /></CandidateShell>);
const workspace = () => document.querySelector("[data-pf-account-workspace]") as HTMLElement;
const section = (name: string) => workspace().querySelector(`[data-pf-account-${name}]`) as HTMLElement;
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
  pathnameMock.mockReturnValue("/candidato/cuenta");
  localStorage.clear();
});

describe("candidate account route", () => {
  beforeEach(stubBrowserApis);

  it("keeps Cuenta metadata and exactly one header title before the single workspace", () => {
    expect(metadata.title).toBe("Cuenta");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Cuenta$/u);
    const workspaces = document.querySelectorAll("[data-pf-account-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supplies exactly the frozen candidate identity at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["identity"]);
    expect(props.identity).toBe(CANDIDATE_IDENTITY);
    expect(Object.isFrozen(props.identity)).toBe(true);
  });

  it("renders the exact identity facts without exposing the user id", () => {
    renderRoute();
    expect(facts(section("identity"))).toEqual([
      ["Nombre completo", CANDIDATE_IDENTITY.fullName],
      ["Correo electrónico", CANDIDATE_IDENTITY.email],
      ["Tipo de cuenta", "Candidata"],
      ["Alcance", "Demo local"],
    ]);
    expect(workspace().textContent ?? "").not.toMatch(UUID);
    expect(workspace()).not.toHaveTextContent(CANDIDATE_IDENTITY.userId);
  });

  it("renders the exact unavailable access and security facts", () => {
    renderRoute();
    expect(facts(section("access"))).toEqual([
      ["Autenticación y sesión", "No disponibles en esta demo"],
      ["Proveedor", "No disponible"],
      ["Verificación de correo", "No disponible"],
    ]);
  });

  it("renders exactly the disabled actions with the shared explanation and disclosure", () => {
    renderRoute();
    expect(buttons().map((button) => button.textContent)).toEqual([...ACTION_LABELS]);
    for (const button of buttons()) {
      expect([button.getAttribute("type"), button.disabled, button.getAttribute("onclick")]).toEqual(["button", true, null]);
      expect(button).toHaveAttribute("aria-describedby", NOTE_ID);
    }
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-pf-account-disclosure");
    for (const claim of ["identidad ficticia", "sesión autenticada real", "ni credenciales", "Nada se puede cambiar, guardar ni enviar"]) {
      expect(note).toHaveTextContent(claim);
    }
    const explanation = workspace().querySelector(`[data-pf-account-actions-note]#${NOTE_ID}`) as HTMLElement;
    expect(explanation).toHaveTextContent(/^Esta demo local no puede cambiar el correo ni la contraseña ni cerrar sesión porque no hay autenticación conectada\.$/u);
  });

  it("keeps the workspace free of links, forms, inputs and handlers", () => {
    renderRoute();
    expect(workspace().querySelectorAll("a, form, input, [onclick]")).toHaveLength(0);
  });

  it("activates only Cuenta inside the shared candidate shell", () => {
    renderRoute();
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual(["Cuenta"]);
  });

  it("replaces the final placeholder preview and owns no shell, side effect or fixture literal", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["CandidateDestinationShell", "data-pf-destination", "preview", "summary"]) {
      expect(SOURCE, `page must not keep placeholder ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation", "useRouter", "fetch(", "localStorage", "sessionStorage", "document.cookie", "useState", "useEffect", "onClick", "<form", "<input", "<main", "window.", "redirect("]) {
      expect(SOURCE, `page must not own ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
    expect(SOURCE).toContain('import { AccountWorkspace } from "@/features/candidate/account-workspace"');
    expect(SOURCE).toContain('import { CANDIDATE_IDENTITY } from "@/features/candidate/prototype-candidate"');
    expect(SOURCE).toContain('title="Cuenta"');
    expect(SOURCE).toContain("<AccountWorkspace identity={CANDIDATE_IDENTITY} />");
  });
});
