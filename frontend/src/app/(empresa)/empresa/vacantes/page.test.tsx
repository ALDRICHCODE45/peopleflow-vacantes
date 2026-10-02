import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EmployerShell } from "@/components/company-dashboard/employer-shell";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies";

import PageContent, { metadata } from "./page";

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
  join(process.cwd(), "src/app/(empresa)/empresa/vacantes/page.tsx"),
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

describe("/empresa/vacantes employer route", () => {
  beforeEach(stubBrowserApis);

  it("declares its own truthful Spanish route metadata", () => {
    expect(metadata.title).toBe("Vacantes");
  });

  it("reuses the shared employer shell without duplicating it", () => {
    render(<Page />);

    // The (empresa) layout owns the single frame: the route must not mount a
    // second sidebar provider, wrapper or brand navigation.
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper!.getAttribute("style")).toContain("--sidebar-width");
    expect(wrapper!.getAttribute("style")).toContain("--header-height");

    // The committed recruiting navigation still reaches the section route.
    expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute(
      "href",
      "/empresa/vacantes",
    );
  });

  it("renders the shared header with the route title and shell controls", () => {
    render(<Page />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(within(header!).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Vacantes",
    );
    expect(
      within(header!).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(header!).getByRole("button", { name: "Cambiar tema" }),
    ).toBeInTheDocument();
  });

  it("introduces the section and links to the create-vacancy route", () => {
    render(<Page />);

    expect(
      screen.getByText(
        "Gestiona tus vacantes y su publicación en la bolsa de trabajo.",
      ),
    ).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: /Nueva vacante/i });
    expect(cta).toHaveAttribute("href", "/empresa/vacantes/nueva");
  });

  it("renders no route-level local-demo disclosure or implementation-status copy", () => {
    render(<Page />);

    expect(document.querySelector("[data-pf-vacantes-disclosure]")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/datos de demostración locales/i)).toBeNull();
    expect(screen.queryByText(/no se guardan/i)).toBeNull();
  });

  it("mounts the portfolio with every fixture row and its canonical pipeline link", () => {
    const { container } = render(<Page />);

    expect(document.querySelector("[data-pf-vacancy-portfolio]")).not.toBeNull();

    const rows = Array.from(container.querySelectorAll("[data-pf-vacancy-row]"));
    expect(rows.map((row) => row.getAttribute("data-pf-vacancy-row"))).toEqual(
      NEXO_VACANCIES.map((vacancy) => vacancy.id),
    );

    for (const vacancy of NEXO_VACANCIES) {
      const link = container.querySelector(
        `[data-pf-vacancy-pipeline="${vacancy.id}"]`,
      ) as HTMLAnchorElement;
      expect([link.getAttribute("href"), link.getAttribute("aria-label")]).toEqual([
        vacancyPipelineHref(vacancy.id),
        `Ver pipeline de ${vacancy.title}`,
      ]);
    }
  });

  it("bounds the portfolio in the shared employer content container", () => {
    const { container } = render(<Page />);

    const content = container.querySelector("[data-pf-vacantes-content]");
    expect(content).not.toBeNull();
    expect(content!.className).toContain("px-4");
    expect(content!.className).toContain("py-4");
    expect(content!.className).toContain("md:py-6");
    expect(content!.className).toContain("lg:px-6");
    // The route mounts the shared page-content wrapper as its single padding owner
    // and binds it to the candidate canonical measure.
    expect(content!.hasAttribute("data-pf-page-content")).toBe(true);
    for (const token of ["mx-auto", "w-full", "max-w-screen-2xl"]) {
      expect(content!.className).toContain(token);
    }
    expect(content!.contains(document.querySelector("[data-pf-vacancy-portfolio]"))).toBe(
      true,
    );
  });
});

describe("/empresa/vacantes composition boundary", () => {
  it("mounts the shared header, the portfolio and the Nexo fixtures", () => {
    expect(pageSource).toContain('<SiteHeader title="Vacantes" />');
    expect(pageSource).toContain("<VacancyPortfolio vacancies={NEXO_VACANCIES} />");
  });

  it("stays a server component", () => {
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).not.toContain("use client");
  });

  it("declares no request, credential or client-state concern", () => {
    // The route is a composition surface: no data access, no client state, no
    // authentication and no transport call may appear here.
    for (const forbidden of [
      "fetch(",
      "createJob",
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
      "features/jobs",
    ]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    expect(pageSource).not.toMatch(/session|token|company_membership/i);
  });

  it("never imports or mounts a second employer shell", () => {
    // The shared (empresa) layout owns the frame; the route may mention it in
    // prose, but it must not import or render it.
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
    expect(pageSource).not.toContain("company-dashboard/employer-shell");
    expect(pageSource).not.toContain("company-dashboard/ui/sidebar");
  });
});
