import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The shared shell mounts the candidate frame, whose sidebar reads the pathname.
vi.mock("next/navigation", () => ({ usePathname: () => null }));

import { CandidateShell } from "./candidate-shell";
import { CandidateDestinationShell } from "./candidate-destination-shell";

const SOURCE = readFileSync(join(process.cwd(), "src/components/candidate-dashboard/candidate-destination-shell.tsx"), "utf8");

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("candidate destination shell", () => {
  it("renders the shared route header plus a named local preview and honest disclosure", () => {
    stubBrowserApis();
    render(
      <CandidateShell>
        <CandidateDestinationShell title="Perfil" summary="Resumen del perfil de la candidata." preview={["Datos personales", "Idiomas y habilidades"]} />
      </CandidateShell>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Perfil");
    expect(screen.getByText("Resumen del perfil de la candidata.")).toBeInTheDocument();
    expect(screen.getByText("Datos personales")).toBeInTheDocument();
    expect(screen.getByText("Idiomas y habilidades")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/no guarda cambios/i);
    // The frame owns the only main landmark; the destination shell adds no nested one.
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("stays a server component with no form, storage, network or success surface", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/);
    expect(SOURCE).toContain('import { CandidateHeader } from "./candidate-header"');
    for (const forbidden of ["fetch(", "localStorage", "document.cookie", "next/headers", "useState", "onClick", "<form", "<input", "<button", "useRouter", "window.", "sessionStorage"]) {
      expect(SOURCE, `shell must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("uses candidate token roles with responsive horizontal padding and no fixed width", () => {
    expect(SOURCE).toContain("px-4");
    expect(SOURCE).toContain("lg:px-6");
    expect(SOURCE).toContain("bg-primary");
    expect(SOURCE).toContain("text-muted-foreground");
    expect(SOURCE).not.toMatch(/\bw-\[\d+px\]/);
  });
});
