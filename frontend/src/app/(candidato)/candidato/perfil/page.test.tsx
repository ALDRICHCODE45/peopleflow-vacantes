import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { profileToDraft } from "@/features/candidate/profile-draft";

const { pathnameMock, workspaceSpy } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/candidato/perfil"),
  workspaceSpy: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Wrap the real workspace so the route test observes the exact boundary props
// while still rendering the committed editor, review and reset behavior.
vi.mock("@/features/candidate/profile-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/candidate/profile-workspace")>();
  const RealWorkspace = actual.ProfileWorkspace;
  return {
    ...actual,
    ProfileWorkspace: (props: React.ComponentProps<typeof RealWorkspace>) => {
      workspaceSpy(props);
      return <RealWorkspace {...props} />;
    },
  };
});

import PerfilPage, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

const SOURCE = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/perfil/page.tsx"), "utf8");
const AVATAR_SRC = "/candidate/ximena-barrera.jpg";
const SEEDED = profileToDraft(CANDIDATE_PROFILE);
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
  // Forces Base UI's AvatarImage to mount so the local portrait is observable in jsdom.
  vi.stubGlobal("Image", StubImage);
}

class StubImage {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  referrerPolicy = "";
  crossOrigin: string | null = null;
  sizes = "";
  srcset = "";
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

const renderRoute = () => render(<CandidateShell><PerfilPage /></CandidateShell>);
const workspace = () => document.querySelector("[data-pf-profile-workspace]") as HTMLElement;
const field = (path: string) => workspace().querySelector(`[data-pf-profile-field="${path}"]`) as HTMLInputElement;
const dirtyLabel = () => workspace().querySelector("[data-pf-profile-dirty]")?.textContent;
const announcement = () => workspace().querySelector("[data-pf-profile-announcement]");
const rows = () => workspace().querySelectorAll("[data-pf-profile-language-row]");
const review = () => screen.getByRole("button", { name: "Revisar datos" });
const reset = () => screen.getByRole("button", { name: "Restaurar copia original" });
const show = (label: "Personal" | "Experiencia" | "Educación" | "Compensación" | "Idiomas"): void => {
  fireEvent.click(screen.getByRole("tab", { name: label }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  workspaceSpy.mockReset();
  pathnameMock.mockReturnValue("/candidato/perfil");
  localStorage.clear();
});

describe("candidate profile route", () => {
  beforeEach(stubBrowserApis);

  it("keeps Perfil metadata and exactly one header title before the single workspace", () => {
    expect(metadata.title).toBe("Perfil");
    renderRoute();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Perfil$/u);
    const workspaces = document.querySelectorAll("[data-pf-profile-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(headings[0].compareDocumentPosition(workspaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supplies exactly the frozen identity and profile at the page boundary", () => {
    renderRoute();
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["identity", "profile", "avatarSrc"]);
    expect(props.identity).toBe(CANDIDATE_IDENTITY);
    expect(props.profile).toBe(CANDIDATE_PROFILE);
    expect(props.avatarSrc).toBe(AVATAR_SRC);
    expect(Object.isFrozen(props.identity)).toBe(true);
    expect(Object.isFrozen(props.profile)).toBe(true);
  });

  it("renders the frozen identity header and the local completion summary", () => {
    renderRoute();
    const header = workspace().querySelector("[data-pf-profile-identity]") as HTMLElement;
    expect(header).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(header).toHaveTextContent(CANDIDATE_IDENTITY.email);
    expect(header).not.toHaveTextContent(CANDIDATE_IDENTITY.userId);
    const bar = workspace().querySelector("[data-slot='progress']") as HTMLElement;
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(workspace()).toHaveTextContent("10 de 10 datos clave");
  });

  it("renders the route-provided local portrait inside the profile card", () => {
    renderRoute();
    expect(workspace().querySelector("[data-slot='card']")).not.toBeNull();
    const image = workspace().querySelector("[data-slot='avatar-image']") as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.getAttribute("src")).toBe(AVATAR_SRC);
    expect(image.getAttribute("alt")).toContain(CANDIDATE_IDENTITY.fullName);
  });

  it("seeds the committed values across the five tab panels", () => {
    renderRoute();
    expect(field("city")).toHaveValue(CANDIDATE_PROFILE.city);
    show("Experiencia");
    expect(field("professionalTitle")).toHaveValue(SEEDED.professionalTitle);
    show("Compensación");
    expect(field("salaryCurrency")).toHaveValue("MXN");
    show("Idiomas");
    expect(screen.getByLabelText("Nombre del idioma 1")).toHaveValue("español");
    expect(screen.getByLabelText("Nivel del idioma 2")).toHaveTextContent("Intermedio alto");
  });

  it("keeps edits and the dirty flag local without mutating the frozen profile", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    renderRoute();
    expect(dirtyLabel()).toBe("Sin cambios pendientes");
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    expect(field("city")).toHaveValue(`${CANDIDATE_PROFILE.city}!`);
    expect(dirtyLabel()).toBe("Cambios pendientes");
    expect(reset()).toBeEnabled();
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("reports an invalid local review, focuses the first error and saves nothing", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    renderRoute();
    fireEvent.change(screen.getByLabelText("Perfil de LinkedIn"), { target: { value: "no-es-una-url" } });
    show("Experiencia");
    fireEvent.change(screen.getByLabelText("Años de experiencia"), { target: { value: "12.5" } });
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(screen.getByRole("tab", { name: "Personal" })).toHaveAttribute("aria-selected", "true");
    expect(field("linkedinUrl")).toHaveAttribute("aria-invalid", "true");
    expect(announcement()).toHaveTextContent("La revisión encontró 3 errores.");
    expect(field("linkedinUrl")).toHaveFocus();
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("restores the seeded copy locally after edits and a local review", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    renderRoute();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    show("Idiomas");
    await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
    expect(rows()).toHaveLength(3);
    await user.click(reset());
    expect(rows()).toHaveLength(2);
    show("Personal");
    expect(field("city")).toHaveValue(CANDIDATE_PROFILE.city);
    expect(announcement()).toHaveTextContent("Restauramos la copia original");
    expect(dirtyLabel()).toBe("Sin cambios pendientes");
    expect(reset()).toBeDisabled();
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("renders no implementation-status disclosure and activates only Perfil", () => {
    renderRoute();
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.querySelector("[data-pf-profile-disclosure]")).toBeNull();
    const nav = document.querySelector("[data-slot='sidebar-content']") as HTMLElement;
    const active = within(nav).getAllByRole("link").filter((link) => link.hasAttribute("data-active")).map((link) => link.textContent);
    expect(active).toEqual(["Perfil"]);
  });

  it("replaces the placeholder preview and owns no shell, side effect or fixture literal", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["CandidateDestinationShell", "data-pf-destination", "preview", "summary", "Vista previa"]) {
      expect(SOURCE, `page must not keep placeholder ${forbidden}`).not.toContain(forbidden);
    }
    for (const forbidden of ["SidebarProvider", "Sidebar", "CandidateShell", "candidate-theme", "next/headers", "next/navigation", "useRouter", "fetch(", "localStorage", "sessionStorage", "document.cookie", "useState", "useEffect", "onClick", "<form", "<input", "<main", "window.", "redirect("]) {
      expect(SOURCE, `page must not own ${forbidden}`).not.toContain(forbidden);
    }
    expect(SOURCE).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
    expect(SOURCE).toContain('import { ProfileWorkspace } from "@/features/candidate/profile-workspace"');
    expect(SOURCE).toContain('import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate"');
    expect(SOURCE).toContain('title="Perfil"');
    expect(SOURCE).toContain('avatarSrc="/candidate/ximena-barrera.jpg"');
    expect(occurrences(SOURCE, '<CandidateHeader title="Perfil" />')).toBe(1);
    expect(occurrences(SOURCE, '<ProfileWorkspace identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} avatarSrc="/candidate/ximena-barrera.jpg" />')).toBe(1);
  });
});
