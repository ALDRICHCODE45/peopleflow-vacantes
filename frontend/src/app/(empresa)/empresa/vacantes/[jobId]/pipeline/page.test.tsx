import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EmployerShell } from "@/components/company-dashboard/employer-shell";
import {
  EMPLOYER_VACANCY_STATE_LABELS,
  vacancyCandidateTotal,
} from "@/features/employer-vacancies/model";
import { filterCandidatesByVacancy } from "@/features/employer-vacancies/pipeline-model";
import { NEXO_CANDIDATES } from "@/features/employer-vacancies/prototype-candidates";
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies";

import Page, { generateMetadata } from "./page";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(empresa)/empresa/vacantes/[jobId]/pipeline/page.tsx",
  ),
  "utf8",
);

/** The framework not-found signal, stubbed so the page contract is observable. */
const NEXT_NOT_FOUND = new Error("NEXT_NOT_FOUND");

// The employer shell mounts the sidebar, which reads the current pathname.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NEXT_NOT_FOUND;
  },
  usePathname: () => "/empresa/vacantes/backend-developer-senior/pipeline",
}));

const paramsFor = (jobId: string) => Promise.resolve({ jobId });

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the
// first through `useIsMobile`, so both browser APIs are stubbed to the desktop
// branch, mirroring the shared shell tests.
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

// Mirrors the (empresa) layout: the shell wraps the route content.
async function renderPipeline(jobId: string) {
  const content = await Page({ params: paramsFor(jobId) });
  return render(<EmployerShell>{content}</EmployerShell>);
}

const candidateNoun = (total: number) => (total === 1 ? "candidato" : "candidatos");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/empresa/vacantes/[jobId]/pipeline metadata", () => {
  it("titles the document with the resolved vacancy and nothing else", async () => {
    for (const vacancy of NEXO_VACANCIES) {
      expect(await generateMetadata({ params: paramsFor(vacancy.id) })).toEqual({
        title: `${vacancy.title} · Pipeline`,
      });
    }
  });

  it("returns empty metadata for unknown, near-miss, and malformed ids", async () => {
    for (const id of [
      "no-existe",
      "backend-developer",
      "BACKEND-DEVELOPER-SENIOR",
      "backend_developer_senior",
      "",
    ]) {
      expect(await generateMetadata({ params: paramsFor(id) })).toEqual({});
    }
  });
});

describe("/empresa/vacantes/[jobId]/pipeline not found", () => {
  it("routes unknown, near-miss, and malformed ids to notFound()", async () => {
    for (const id of [
      "no-existe",
      "backend-developer",
      "BACKEND-DEVELOPER-SENIOR",
      "backend_developer",
      "backend-developer-senior ",
    ]) {
      await expect(Page({ params: paramsFor(id) })).rejects.toThrow(NEXT_NOT_FOUND);
    }
  });

  it("never renders a fallback vacancy for an unknown id", async () => {
    await expect(Page({ params: paramsFor("no-existe") })).rejects.toThrow(
      NEXT_NOT_FOUND,
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Pipeline" })).toBeNull();
    expect(document.querySelector("[data-pf-pipeline-content]")).toBeNull();
  });
});

describe("/empresa/vacantes/[jobId]/pipeline header context", () => {
  beforeEach(stubBrowserApis);

  it("shows the parent breadcrumb, the vacancy title, and the Spanish status", async () => {
    const vacancy = NEXO_VACANCIES[0];
    await renderPipeline(vacancy.id);

    const header = document.querySelector("header")!;
    const nav = within(header).getByRole("navigation", { name: "Ruta de navegación" });
    expect(within(nav).getByRole("link", { name: "Vacantes" })).toHaveAttribute(
      "href",
      "/empresa/vacantes",
    );
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(
      vacancy.title,
    );

    const status = header.querySelector("[data-pf-vacancy-status]")!;
    expect(status).toHaveTextContent(EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]);
    expect(status).toBeVisible();
  });

  it("renders every vacancy with its own title and local Spanish status", async () => {
    for (const vacancy of NEXO_VACANCIES) {
      const { container, unmount } = await renderPipeline(vacancy.id);
      const header = container.querySelector("header")!;
      expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(
        vacancy.title,
      );
      const status = header.querySelector("[data-pf-vacancy-status]")!;
      expect(status).toHaveAttribute("data-pf-vacancy-status", vacancy.state);
      expect(status).toHaveTextContent(EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]);
      unmount();
    }
  });
});

describe("/empresa/vacantes/[jobId]/pipeline content", () => {
  beforeEach(stubBrowserApis);

  it("introduces the Pipeline section with the truthful team size and portfolio total", async () => {
    const vacancy = NEXO_VACANCIES[0];
    const total = vacancyCandidateTotal(vacancy.candidateCounts);
    const { container } = await renderPipeline(vacancy.id);

    expect(screen.getByRole("heading", { level: 2, name: "Pipeline" })).toBeVisible();
    const intro = container.querySelector("[data-pf-pipeline-intro]")!;
    expect(intro).toHaveTextContent(`${total} ${candidateNoun(total)} en el historial`);
    expect(intro).toHaveTextContent(`${vacancy.teamSize} miembros del equipo`);
  });

  it("discloses that the cards are local demo data and are not persisted", async () => {
    const { container } = await renderPipeline(NEXO_VACANCIES[0].id);

    const disclosure = container.querySelector("[data-pf-pipeline-disclosure]")!;
    expect(disclosure).toHaveAttribute("role", "note");
    expect(disclosure).toHaveTextContent(/demostración/i);
    expect(disclosure).toHaveTextContent(/no se guardan/i);
  });

  it("mounts the shared workspace in the standard employer content padding", async () => {
    const { container } = await renderPipeline(NEXO_VACANCIES[0].id);

    const content = container.querySelector("[data-pf-pipeline-content]")!;
    expect(content.className).toContain("px-4");
    expect(content.className).toContain("lg:px-6");
    expect(content.contains(container.querySelector("[data-pf-pipeline]"))).toBe(true);
    expect(container.querySelector("[data-pf-pipeline-search]")).not.toBeNull();
    expect(container.querySelector("[data-pf-pipeline-view]")).not.toBeNull();
  });
});

describe("/empresa/vacantes/[jobId]/pipeline candidate scoping", () => {
  beforeEach(stubBrowserApis);

  it("renders only the resolved vacancy's representative cards", async () => {
    const vacancy = NEXO_VACANCIES[0];
    const expected = filterCandidatesByVacancy(NEXO_CANDIDATES, vacancy.id);
    const { container } = await renderPipeline(vacancy.id);

    const ids = Array.from(
      container.querySelectorAll("[data-pf-pipeline-card]"),
    ).map((card) => card.getAttribute("data-pf-pipeline-card"));
    expect(ids).toEqual(expected.map((candidate) => candidate.id));

    // A candidate that belongs to a different vacancy never leaks into this route.
    const foreign = filterCandidatesByVacancy(NEXO_CANDIDATES, NEXO_VACANCIES[1].id)[0];
    expect(screen.queryByText(foreign.fullName)).toBeNull();
  });

  it("renders each of the six vacancies with its own scoped pipeline", async () => {
    for (const vacancy of NEXO_VACANCIES) {
      const expected = filterCandidatesByVacancy(NEXO_CANDIDATES, vacancy.id);
      expect(expected.length).toBeGreaterThan(0);

      const { container, unmount } = await renderPipeline(vacancy.id);
      const ids = Array.from(
        container.querySelectorAll("[data-pf-pipeline-card]"),
      ).map((card) => card.getAttribute("data-pf-pipeline-card"));
      expect(ids).toEqual(expected.map((candidate) => candidate.id));
      unmount();
    }
  });
});

describe("/empresa/vacantes/[jobId]/pipeline source boundaries", () => {
  it("stays a server component with exact-id lookup and the shared workspace", () => {
    expect(pageSource).not.toMatch(/["']use client["']/u);
    expect(pageSource).toMatch(/params:\s*Promise<\{\s*jobId: string\s*\}>/u);
    expect(pageSource).toMatch(/await params/u);
    expect(pageSource).toMatch(/findEmployerVacancy\(/u);
    expect(pageSource).toMatch(/\bnotFound\(\)/u);
    expect(pageSource).toMatch(/export async function generateMetadata/u);
    expect(pageSource).toMatch(/filterCandidatesByVacancy\(/u);
    expect(pageSource).toMatch(/<PipelineWorkspace\b/u);
    expect(pageSource).not.toMatch(/Nueva candidatura|Agregar candidato|PlusIcon/u);
  });

  it("owns no request, credential, storage or client-state concern", () => {
    for (const forbidden of [
      "fetch(",
      "lib/api",
      "QueryClient",
      "useState",
      "useEffect",
      "useRouter",
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
    expect(pageSource).not.toMatch(/\bsession\b|\btoken\b/i);
  });

  it("never duplicates the employer shell and claims no public indexing", () => {
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
    expect(pageSource).not.toContain("company-dashboard/employer-shell");
    expect(pageSource).not.toContain("company-dashboard/ui/sidebar");
    expect(pageSource).not.toMatch(/\brobots\b|\bcanonical\b/u);
  });
});
