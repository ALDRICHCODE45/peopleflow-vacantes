import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import PageContent, { metadata } from "./page";
import { EmployerShell } from "@/components/company-dashboard/employer-shell";

// Mirrors the (empresa) layout: the shell wraps the route content.
function Page() {
  return (
    <EmployerShell>
      <PageContent />
    </EmployerShell>
  );
}

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(
  join(process.cwd(), "src/app/(empresa)/empresa/vacantes/nueva/page.tsx"),
  "utf8",
);

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

describe("/empresa/vacantes/nueva employer route", () => {
  beforeEach(stubBrowserApis);

  it("declares its own truthful Spanish route metadata", () => {
    expect(metadata.title).toBe("Nueva vacante");
  });

  it("mirrors the committed dashboard shell frame", () => {
    render(<Page />);

    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper).not.toBeNull();
    // The same shell custom properties the committed dashboard route declares.
    expect(wrapper!.getAttribute("style")).toContain("--sidebar-width");
    expect(wrapper!.getAttribute("style")).toContain("--header-height");

    expect(document.querySelector("[data-slot='sidebar']")).toHaveAttribute(
      "data-variant",
      "inset",
    );
    expect(document.querySelector("[data-slot='sidebar-inset']")).not.toBeNull();

    // The committed recruiting navigation is reused as-is, so the employer can
    // still reach the dashboard from the new screen.
    expect(screen.getByRole("link", { name: "PeopleFlow" })).toHaveAttribute(
      "href",
      "/empresa/dashboard",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/empresa/dashboard",
    );
  });

  it("renders the route header and the verified form body", () => {
    render(<Page />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(within(header!).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Nueva vacante",
    );
    expect(
      within(header!).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(header!).getByRole("button", { name: "Cambiar tema" }),
    ).toBeInTheDocument();

    // The wizard form body owns every editable surface of the route.
    expect(
      screen.getByRole("textbox", { name: /título del puesto/i }),
    ).toBeInTheDocument();
    // Step one is the visible step; the save affordance lives on review.
    expect(
      screen.getByRole("button", { name: "Continuar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar"),
    ).toHaveAttribute("aria-valuetext", "Paso 1 de 4");
    expect(
      screen.queryByRole("button", { name: /guardar borrador/i }),
    ).toBeNull();
  });

  it("bounds the form body in a responsive content container", () => {
    render(<Page />);

    const content = document.querySelector("[data-pf-create-vacancy-content]");
    expect(content).not.toBeNull();
    expect(content!.className).toContain("mx-auto");
    // The enriched screen uses the wide desktop canvas deliberately.
    expect(content!.className).toContain("max-w-7xl");
    expect(content!.className).not.toContain("max-w-5xl");
    expect(content!.className).toContain("px-4");
    expect(content!.className).toContain("py-4");
    expect(content!.className).toContain("md:py-6");
    expect(content!.className).toContain("lg:px-6");
    // The route mounts the shared page-content wrapper as its single padding owner.
    expect(content!.hasAttribute("data-pf-page-content")).toBe(true);
    expect(
      content!.contains(screen.getByRole("textbox", { name: /título del puesto/i })),
    ).toBe(true);
  });
});

describe("/empresa/vacantes/nueva composition boundary", () => {
  it("mounts only its header and the verified form body", () => {
    // The (empresa) layout owns the single frame and guards the route tokens;
    // this route contributes only its own header and the form body.
    expect(pageSource).toContain("<CreateVacancyHeader />");
    expect(pageSource).toContain("<CreateVacancyForm />");
  });

  it("stays a server component", () => {
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).not.toContain("use client");
  });

  it("declares no request, credential or client-state concern", () => {
    // The route is a composition surface: no data access, no client state, no
    // authentication, and no transport call may appear here.
    for (const forbidden of [
      "createJob",
      "lib/api",
      "QueryClient",
      "useRouter",
      "useState",
      "useEffect",
      "Authorization",
      "Bearer",
      "localStorage",
      "cookies",
      "fetch(",
    ]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(pageSource).not.toMatch(/session|token|company_membership/i);
  });
});
