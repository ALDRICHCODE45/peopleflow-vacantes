import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EmployerShell } from "@/components/company-dashboard/employer-shell";

import PageContent, { metadata } from "./page";

// Mirrors the (empresa) layout: the shared shell wraps the route content.
function Page() {
  return (
    <EmployerShell>
      <PageContent />
    </EmployerShell>
  );
}

const continueButton = () => screen.getByRole("button", { name: "Continuar" });
const backButton = () => screen.getByRole("button", { name: "Atrás" });
/** Number of the step currently exposed, read from the progress indicator. */
function currentStep(): number {
  const item = document.querySelector(
    "[data-pf-draft-progress] [aria-current='step']",
  );
  const value = item?.getAttribute("data-step");
  if (!value) throw new Error("No exposed wizard step");
  return Number(value);
}
/** Explicit step navigation; hidden controls are never queried by role. */
function goToStep(target: number) {
  while (currentStep() < target) fireEvent.click(continueButton());
  while (currentStep() > target) fireEvent.click(backButton());
}

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(empresa)/empresa/vacantes/borradores/nuevo/page.tsx",
  ),
  "utf8",
);

// jsdom lacks the layout and pointer APIs the Base UI primitives read.
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

function stubBrowserApis() {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/empresa/vacantes/borradores/nuevo employer route", () => {
  beforeEach(stubBrowserApis);

  it("declares its own truthful Spanish route metadata", () => {
    expect(metadata.title).toBe("Nuevo borrador");
  });

  it("reuses the shared employer shell without duplicating it", () => {
    render(<Page />);

    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper!.getAttribute("style")).toContain("--sidebar-width");
    expect(wrapper!.getAttribute("style")).toContain("--header-height");

    // Both the sidebar entry and the breadcrumb return to the section route.
    const sectionLinks = screen.getAllByRole("link", { name: "Vacantes" });
    expect(sectionLinks.length).toBeGreaterThan(0);
    for (const link of sectionLinks) {
      expect(link).toHaveAttribute("href", "/empresa/vacantes");
    }
  });

  it("renders the shared header with the route title, breadcrumb and shell controls", () => {
    render(<Page />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(within(header!).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Nuevo borrador",
    );
    expect(
      within(header!).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(header!).getByRole("button", { name: "Cambiar tema" }),
    ).toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Ruta de navegación",
    });
    expect(
      within(breadcrumb).getByRole("link", { name: "Vacantes" }),
    ).toHaveAttribute("href", "/empresa/vacantes");
  });

  it("mounts the five-step draft editor with explicit account saving inside the shared content container", () => {
    render(<Page />);

    expect(
      screen.getByRole("textbox", { name: "Título" }),
    ).toBeInTheDocument();
    // Location is the shared structured LocationField (catalog codes), not free text.
    // Its controls appear once the public catalog loads (covered in features/geo and drafts tests).
    expect(screen.getByRole("region", { name: "Ubicación" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Ubicación" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Modalidad" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Al pulsar Guardar borrador, se guardará en tu cuenta. No hay guardado automático",
    );

    // Every approved group is a semantic section of one wide, non-modal surface,
    // reached through the approved progressive steps.
    const steps = [
      {
        heading: "Paso 1 de 5: Información básica",
        sections: ["Detalles de la vacante", "Solicitante"],
      },
      {
        heading: "Paso 2 de 5: Descripción y perfil",
        sections: ["Requisitos", "Habilidades", "Idiomas", "Descripción"],
      },
      {
        heading: "Paso 3 de 5: Compensación y beneficios",
        sections: ["Compensación", "Prestaciones"],
      },
      {
        heading: "Paso 4 de 5: Preguntas",
        sections: ["Preguntas de filtro"],
      },
      {
        heading: "Paso 5 de 5: Revisión final",
        sections: [],
      },
    ];
    for (let step = 1; step <= steps.length; step += 1) {
      goToStep(step);
      expect(
        screen.getByRole("heading", { name: steps[step - 1].heading }),
      ).toBeVisible();
      for (const heading of steps[step - 1].sections) {
        expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      }
    }

    expect(
      screen.getByRole("button", { name: "Guardar borrador" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-pf-local-draft-form]")).not.toBeNull();

    const content = document.querySelector("[data-pf-draft-vacante-content]");
    expect(content).not.toBeNull();
    expect(content!.className).toContain("mx-auto");
    expect(content!.className).toContain("max-w-7xl");
    expect(content!.className).toContain("px-4");
    expect(content!.className).toContain("py-4");
    expect(content!.className).toContain("md:py-6");
    expect(content!.className).toContain("lg:px-6");
    expect(content!.hasAttribute("data-pf-page-content")).toBe(true);
    expect(
      content!.contains(screen.getByRole("button", { name: "Guardar borrador" })),
    ).toBe(true);
    // The narrow legacy measure must not come back anywhere in the route.
    expect(content!.querySelector(".max-w-3xl")).toBeNull();
  });
});

describe("/empresa/vacantes/borradores/nuevo composition boundary", () => {
  it("mounts only the shared header and the local editor", () => {
    expect(pageSource).toContain("<SiteHeader");
    expect(pageSource).toContain("<LocalDraftForm />");
    expect(pageSource).toContain(
      'from "@/features/jobs/drafts/ui/local-draft-form"',
    );
  });

  it("stays a server component", () => {
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).not.toContain("use client");
  });

  it("declares no request, credential or client-state concern", () => {
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
    ]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(pageSource).not.toMatch(/session|token|company_membership/i);
  });

  it("never imports or mounts a second employer shell", () => {
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
    expect(pageSource).not.toContain("company-dashboard/employer-shell");
    expect(pageSource).not.toContain("company-dashboard/ui/sidebar");
  });
});
